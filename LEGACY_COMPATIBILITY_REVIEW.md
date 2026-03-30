# Legacy Compatibility Implementation Review
## @auth0/auth0-express — Migration from express-openid-connect

---

## Executive Summary

The implementation provides a functional foundation for backward compatibility with `express-openid-connect` sessions during migration to `@auth0/auth0-express`. However, there are **critical and major gaps** that will cause silent session failures in production, particularly around:

1. **Signed cookie handling** — no support for HMAC-signed session IDs in stateful mode
2. **`legacySecret` not wired to stateful store** — signed cookies cannot be verified
3. **Chunked cookie reassembly** — legacy cookies >4096 bytes are not reassembled
4. **Key rotation** — no support for legacy secret arrays (multiple secrets)
5. **`deleteByLogoutToken` throws** — breaks apps with backchannel logout configured
6. **JWT expiration not validated** — expired legacy sessions may be silently restored
7. **Default scope documentation mismatch** — `types.ts` JSDoc disagrees with implementation
8. **`internal.createdAt` uses current time** — should use actual session creation time
9. **Duplicate transformation code** — identical logic across two classes
10. **Legacy stores not exported** from package public API

The HKDF key derivation, JWE decryption flow, graceful fallback pattern, and test coverage are all solid. The fixes below are concrete and achievable.

---

## Critical Issues (Must Fix Before Shipping)

### 1. Signed Cookie Handling Missing (Stateful Store)

**Impact:** Any app that had `signSessionStoreCookie: true` in `express-openid-connect` will silently fail to restore sessions. Users are logged out.

When `signSessionStoreCookie: true`, the cookie value is `sessionId.base64UrlSignature` (HMAC-HS256 signed using an HKDF-derived key with info `"JWS Cookie Signing"`). The current code passes the raw value directly to the store `get()`, but the store key is the unsigned ID — so the lookup always misses.

**What needs to happen:**
1. Detect the `id.signature` format
2. Derive the signing key via HKDF with info `"JWS Cookie Signing"` (32 bytes, SHA-256, empty salt)
3. Verify the HMAC-HS256 signature using a timing-safe comparison
4. Strip the signature and use only the session ID as the store key

```typescript
// HKDF for signing key uses a different info string than encryption
async #deriveLegacySigningKey(secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', info: encoder.encode('JWS Cookie Signing'), salt: new Uint8Array(0) } as HkdfParams,
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}
```

---

### 2. `legacySecret` Not Passed to Stateful Store

**Impact:** Same as above — signed cookie verification is impossible without it.

`LegacyCompatibleStatefulStoreOptions` has no `legacySecret` field, and the `getStateStore` factory in `utils.ts` does not forward `options.legacyCompatibility?.legacySecret` to the stateful store.

**Files to change:**
- `store/legacy-compatible-stateful-state-store.ts` — add `legacySecret?: string | string[]` to `LegacyCompatibleStatefulStoreOptions`, store as `protected readonly legacySecrets: string[]`
- `utils.ts` — pass `legacySecret: options.legacyCompatibility?.legacySecret` in the stateful store factory call

---

### 3. Chunked Cookie Reassembly Not Implemented (Stateless Store)

**Impact:** Any user whose legacy cookie exceeds 4096 bytes has their session silently dropped. This is common with rich ID token claims or many custom session properties.

`express-openid-connect` splits oversized cookies into chunks named `appSession.0`, `appSession.1`, etc. The chunks must be concatenated (in index order) before JWE decryption. The current `decrypt()` override receives only the first/unchunked cookie value; if the session was chunked, the truncated ciphertext fails decryption on both the modern and legacy paths.

**Fix:** Before attempting legacy decryption, check for and reassemble numbered cookie chunks:

```typescript
protected reassembleChunkedCookie(cookieName: string, options?: TStoreOptions): string | undefined {
  const chunks: string[] = [];
  let index = 0;
  while (true) {
    // express-openid-connect chunk naming: cookieName for index 0, cookieName.1, cookieName.2, ...
    const chunkName = index === 0 ? cookieName : `${cookieName}.${index}`;
    const chunk = this._cookieHandler.getCookie(chunkName, options);
    if (!chunk) break;
    chunks.push(chunk);
    index++;
  }
  return chunks.length > 0 ? chunks.join('') : undefined;
}
```

Note: the `decrypt` method signature does not expose `options` (store options / request context), so accessing the cookie handler from within `decrypt` requires a design decision — either store the last-seen options, pass them through, or override `get()` in the stateless store similarly to the stateful store.

---

## Major Issues

### 4. No Key Rotation Support (Array of Secrets)

**Impact:** Applications that rotated their `express-openid-connect` secret using an array cannot migrate cleanly.

`express-openid-connect` supports `secret: ['current', 'previous']` and tries each secret for decryption. The current implementation only accepts a single `string`.

**Fix:** Change `legacySecret` to `string | string[]` everywhere and retry decryption with each secret:

```typescript
// types.ts
legacySecret?: string | string[];

// In both store constructors
this.#legacySecrets = Array.isArray(options.legacySecret)
  ? options.legacySecret
  : [options.legacySecret ?? options.secret];

// In #decryptLegacy
for (const secret of this.#legacySecrets) {
  try {
    const key = await this.#deriveLegacyKey(secret);
    const { payload } = await jwtDecrypt(encryptedData, key, { ... });
    return payload as ExpressOpenidConnectSession;
  } catch {
    continue; // try next secret
  }
}
throw new Error('Failed to decrypt with any legacy secret');
```

---

### 5. `deleteByLogoutToken` Throws Instead of No-Op

**Impact:** Any app with backchannel logout configured will crash with an unhandled error when a logout token arrives.

```typescript
// Current (bad)
override deleteByLogoutToken(): Promise<void> {
  throw new Error('Backchannel logout is not supported in legacy compatibility mode.');
}

// Fix
override async deleteByLogoutToken(): Promise<void> {
  // Legacy express-openid-connect sessions do not use logout tokens.
  // This is intentionally a no-op; users should rely on the standard logout endpoint.
}
```

---

### 6. JWT Expiration Not Explicitly Validated in Legacy Path

**Impact:** Expired legacy sessions may be silently restored.

In `express-openid-connect`'s stateless format, `exp` is stored in the **JOSE protected header** (not the payload). `jwtDecrypt` from jose v5 validates payload `exp` claims but may not validate header-level claims. Add an explicit expiration check and clock tolerance:

```typescript
const { payload, protectedHeader } = await jwtDecrypt(encryptedData, encryptionKey, {
  contentEncryptionAlgorithms: ['A256GCM'],
  keyManagementAlgorithms: ['dir'],
  clockTolerance: 60,
});

// Validate header-level exp if present (express-openid-connect puts it there)
const headerExp = (protectedHeader as Record<string, unknown>).exp;
if (typeof headerExp === 'number' && headerExp < Math.floor(Date.now() / 1000)) {
  throw new Error('Legacy session expired');
}
```

---

### 7. Default `legacyScope` Documentation Mismatch

`types.ts` JSDoc says `@default ''` but both store implementations default to `'openid profile email offline_access'`. The implementation default is the correct one for a migration scenario.

**Fix:** Update `types.ts`:
```typescript
/**
 * The scope to assign to access tokens migrated from express-openid-connect sessions.
 * @default 'openid profile email offline_access'
 */
legacyScope?: string;
```

---

### 8. `internal.createdAt` Uses Current Time Instead of Session Creation Time

In `LegacyCompatibleStatefulStateStore.transformLegacyStorePayload`, the session creation time is available in `payload.header.iat` but is discarded. `internal.createdAt` is set to `Date.now() / 1000` instead.

**Fix:**
```typescript
protected transformLegacyStorePayload(payload: ExpressOpenidConnectStorePayload): StateData {
  const sessionData = this.transformLegacySession(payload.data);
  sessionData.internal.createdAt = payload.header.iat; // Use actual creation time
  return sessionData;
}
```

---

## Minor Issues

### 9. Duplicate `transformLegacySession` / `decodeJWT` Across Both Stores

Identical logic exists in both `LegacyCompatibleStatelessStateStore` (as private `#` methods) and `LegacyCompatibleStatefulStateStore` (as `protected` methods). Extract to a shared utility:

```typescript
// store/legacy-session-transformer.ts
export class LegacySessionTransformer {
  constructor(private readonly audience: string, private readonly scope: string) {}

  transform(legacy: ExpressOpenidConnectSession): StateData { ... }
  decodeJWT(token: string): UserClaims | undefined { ... }
}
```

---

### 10. Legacy Stores Not Exported from Public API

Neither `LegacyCompatibleStatelessStateStore` nor `LegacyCompatibleStatefulStateStore` are exported from `packages/auth0-express/src/index.ts`. Advanced users who need to customize instantiation cannot do so.

**Fix — add to `index.ts`:**
```typescript
export { LegacyCompatibleStatelessStateStore } from './store/legacy-compatible-stateless-state-store.js';
export { LegacyCompatibleStatefulStateStore } from './store/legacy-compatible-stateful-state-store.js';
export type { LegacyCompatibleStoreOptions } from './store/legacy-compatible-stateless-state-store.js';
export type { LegacyCompatibleStatefulStoreOptions } from './store/legacy-compatible-stateful-state-store.js';
```

---

## What Looks Good

- **HKDF key derivation is correct** — digest (`SHA-256`), empty salt, info `"JWE CEK"` all match the `express-openid-connect` spec exactly.
- **Graceful fallback pattern** — modern → legacy → rethrow is the right approach.
- **Custom property preservation** — unknown session fields are forwarded correctly.
- **Test coverage** — both spec files cover happy paths and edge cases well.
- **Separation of concerns** — stateless vs. stateful stores correctly model the two session architectures.

---

## Prioritized Action Plan

### Phase 1 — Critical (must fix before shipping)

| # | Issue | Effort |
|---|-------|--------|
| 1 | Add `legacySecret` to `LegacyCompatibleStatefulStoreOptions` and wire it through `utils.ts` | Low |
| 2 | Implement signed cookie stripping + HMAC verification in stateful store | Medium |
| 3 | Implement chunked cookie reassembly in stateless store (and stateful fallback path) | Medium |
| 4 | Support `legacySecret` as `string \| string[]` for key rotation | Medium |
| 5 | Change `deleteByLogoutToken` to a no-op | Low |
| 6 | Add explicit `exp` validation + `clockTolerance` to legacy decrypt | Low |

### Phase 2 — Important (improves correctness)

| # | Issue | Effort |
|---|-------|--------|
| 7 | Fix `legacyScope` default JSDoc in `types.ts` | Trivial |
| 8 | Use `payload.header.iat` for `internal.createdAt` in stateful store | Low |

### Phase 3 — Cleanup

| # | Issue | Effort |
|---|-------|--------|
| 9 | Extract shared `LegacySessionTransformer` utility | Medium |
| 10 | Export legacy store classes from `index.ts` | Trivial |

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/auth0-express/src/store/legacy-compatible-stateless-state-store.ts` | Chunked cookie reassembly, `legacySecret` as `string \| string[]`, key rotation retry, `clockTolerance`, explicit `exp` check |
| `packages/auth0-express/src/store/legacy-compatible-stateful-state-store.ts` | Add `legacySecret` field + signed cookie verification, chunked cookie reassembly in fallback path, fix `deleteByLogoutToken`, fix `createdAt` |
| `packages/auth0-express/src/store/legacy-session-transformer.ts` | **New file** — extract shared transformation logic |
| `packages/auth0-express/src/types.ts` | `legacySecret: string \| string[]`, fix `legacyScope` default JSDoc |
| `packages/auth0-express/src/utils.ts` | Pass `legacySecret` to stateful store factory |
| `packages/auth0-express/src/index.ts` | Export both legacy store classes and option interfaces |
| `packages/auth0-express/src/store/legacy-compatible-stateless-state-store.spec.ts` | Add tests: chunked cookies, key rotation, expiration validation |
| `packages/auth0-express/src/store/legacy-compatible-stateful-state-store.spec.ts` | Add tests: signed cookies (valid + invalid), chunked cookies, `deleteByLogoutToken` no-op |
