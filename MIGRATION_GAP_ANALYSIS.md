# Migration Gap Analysis: express-openid-connect → @auth0/auth0-express

## Overview

This document analyses how well the legacy compatibility layer in `@auth0/auth0-express` covers a real-world migration from `express-openid-connect`. It is based on a direct inspection of the `express-openid-connect` source (`lib/appSession.js`, `lib/crypto.js`, `lib/config.js`, `lib/context.js`, `lib/hooks/backchannelLogout/`) and the auth0-server-js base classes.

---

## What Is Already Confirmed Working

| # | Behaviour | Notes |
|---|-----------|-------|
| 1 | JWE decryption (`dir` + `A256GCM`, HKDF-SHA-256, info `"JWE CEK"`, empty salt, 32 bytes) | Exact parameter match with express-openid-connect |
| 2 | JWE header-level `exp` validation | express-openid-connect places `exp` / `iat` / `uat` in the **protected header**, not the payload; this is checked correctly with no clock tolerance, matching express-openid-connect's own behaviour |
| 3 | Key rotation — `legacySecret: string \| string[]` | First secret used for encryption; all tried in order for decryption |
| 4 | Stateless chunked cookie reassembly | The base class `getCookieKeys()` uses `startsWith(identifier)`, which already matches both the unchunked `appSession` cookie and the chunked `appSession.0`, `appSession.1`, … variants used by express-openid-connect |
| 5 | Old-format cookie cleanup after first migration write | `StatelessStateStore.set()` diffs the new chunk names against the existing cookies from the request and deletes any that are no longer present — so an unchunked legacy `appSession` is automatically deleted when `appSession.0` is first written |
| 6 | Stateful signed cookie stripping | HKDF-SHA-256 with info `"JWS Cookie Signing"`, empty salt, 32 bytes; payload is `${cookieName}=${sessionId}` (unencoded, `b64:false`); verified with HMAC-SHA-256 |
| 7 | Stateful unsigned cookie (no-dot) | Used directly as the store lookup key |
| 8 | Stateful chunked session ID reassembly | `#reassembleCookieChunks` scans `getCookies()` for `identifier.N` keys (in practice session IDs are short and never chunked, but the code is defensive) |
| 9 | Stateful legacy store payload transformation | `header.iat` used for `internal.createdAt`; custom fields preserved |
| 10 | Session transformation: field mapping | `id_token` → `idToken`, `access_token` → tokenSet, `refresh_token` → `refreshToken`, `expires_at` (string **or** number) → `expiresAt` (number) |
| 11 | Custom session properties | Any field not in the exclusion set is forwarded into the new `StateData` |
| 12 | `deleteByLogoutToken` | Silent async no-op; does not throw |
| 13 | Stateless `createdAt` uses JWE header `iat` | Session absolute duration is preserved correctly instead of resetting to now |
| 14 | Public API exports | `LegacyCompatibleStatelessStateStore`, `LegacyCompatibleStatefulStateStore`, and their option types are exported from the package |

---

## Gaps and Required Actions

### Gap 1 — Cookie name must be configured explicitly (Critical)

**What express-openid-connect does:**
Default session cookie name is `appSession` (configurable via `session.name`).

**What auth0-server-js does:**
Default session identifier is `__a0_session`.

**Impact:**
If the application does not explicitly set the cookie name to match `appSession`, the legacy compatibility layer receives an empty string from `getCookieKeys` and never attempts legacy decryption. Every user appears to have no session and is forced to log in again — the entire migration is effectively bypassed.

**Required action:**
In `Auth0Options.sessionConfiguration`, set the cookie name to whatever `session.name` was in the express-openid-connect configuration:

```typescript
const { auth0, requireAuth } = createAuth0({
  // …
  sessionConfiguration: {
    cookie: { name: 'appSession' },   // must match session.name in express-openid-connect
  },
  legacyCompatibility: {
    enabled: true,
    legacySecret: process.env.SESSION_SECRET,
  },
});
```

---

### Gap 2 — Session store interface is callback-based vs. promise-based (Critical for stateful migrations)

**What express-openid-connect does:**
The `session.store` interface follows the `express-session` / connect-session contract — all methods use Node.js error-first callbacks:

```typescript
interface SessionStore {
  get(sid: string, callback: (err: any, session: object | null) => void): void;
  set(sid: string, session: object, callback?: (err: any) => void): void;
  destroy(sid: string, callback?: (err: any) => void): void;
  touch(sid: string, session: object, callback?: (err: any) => void): void;
}
```

Popular adapters (`connect-redis`, `connect-mongo`, `connect-pg-simple`, etc.) all implement this interface.

**What auth0-server-js does:**
`AbstractDataStore` is promise-based:

```typescript
interface AbstractDataStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, expiresAt?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
```

**Impact:**
Existing session store adapters cannot be passed directly to `LegacyCompatibleStatefulStateStore`. Connecting to the same Redis/MongoDB instance that express-openid-connect used (so that live sessions are still readable) requires either a new promise-based adapter or a thin wrapper.

**Required action:**
Write a wrapper that bridges the old callback-based adapter to the new promise-based interface. Example for `connect-redis`:

```typescript
import { createClient } from 'redis';
import type { AbstractDataStore } from '@auth0/auth0-server-js';

class RedisDataStore implements AbstractDataStore<unknown> {
  constructor(private readonly client: ReturnType<typeof createClient>) {}

  async get(key: string): Promise<unknown> {
    const raw = await this.client.get(key);
    return raw ? JSON.parse(raw) : undefined;
  }

  async set(key: string, value: unknown, expiresAt?: number): Promise<void> {
    const ttl = expiresAt ? expiresAt - Math.floor(Date.now() / 1000) : undefined;
    const serialized = JSON.stringify(value);
    if (ttl && ttl > 0) {
      await this.client.set(key, serialized, { EX: ttl });
    } else {
      await this.client.set(key, serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}
```

> **Important:** The new store must connect to the **same data source** as the legacy express-openid-connect store for existing sessions to be found.

---

### Gap 3 — Backchannel logout tokens are not carried over (Medium)

**What express-openid-connect does:**
When a backchannel logout notification arrives (`POST /backchannel-logout`), the library writes a record to a separate store keyed by `${issuer}|${sid}` and `${issuer}|${sub}`. On subsequent requests, it checks whether the session's `sid` or `sub` appears in this store; if so, the session is invalidated.

**What the legacy compatibility layer does:**
`deleteByLogoutToken` is a deliberate no-op, which is correct for new sessions. However, logout tokens that were written by the **old** express-openid-connect application before migration are stored in a separate backchannel logout store that `@auth0/auth0-express` has no knowledge of. It will not check that store.

**Impact:**
Any user who was backchannel-logged-out while the application was still running under express-openid-connect retains a valid legacy session cookie. When their next request hits the migrated application, the `LegacyCompatibleStatelessStateStore` or `LegacyCompatibleStatefulStateStore` will restore the session, effectively un-logging them out.

**Severity:**
High if the application uses backchannel logout as a security enforcement mechanism. Low if it is used only for UX (e.g., propagating logout across devices).

**Mitigations (choose one based on risk tolerance):**
- Before switching traffic to the new SDK, wait for the backchannel logout record TTL (equal to the session `absoluteDuration`) to expire naturally.
- Force all users to re-authenticate at migration cutover (e.g., by rotating the session secret so all legacy sessions fail decryption).
- If the new application can query the old backchannel logout store, add a middleware that checks it on the first request after migration.

---

### Gap 4 — In-flight OAuth transactions will fail at cutover (Low / Expected)

**What happens:**
Any user who has clicked "Login" on the old express-openid-connect application but has not yet completed the authorization code exchange will have a transaction cookie encrypted with express-openid-connect's scheme. `@auth0/auth0-express` uses a different `CookieTransactionStore` and will be unable to decrypt it.

**Impact:**
Those users will receive a callback error (`missing_transaction_context` or similar) and must restart the login flow. This is a normal, expected behaviour for any migration that changes session encryption. The window of impact is limited to users mid-login at the precise instant of cutover.

**Mitigation:**
Schedule the migration deployment during a low-traffic window. No code change needed.

---

### Gap 5 — Rolling session `uat` tracking is not preserved (Low)

**What express-openid-connect does:**
It stores `uat` (user access time) in the JWE protected header. On each request, `uat` is updated and a fresh JWE is written; expiry is `min(uat + rollingDuration, iat + absoluteDuration)`.

**What the legacy compatibility layer does:**
The `uat` value is present in the JWE header but is not read or forwarded. After migration, the rolling expiry window is managed by auth0-server-js's own mechanism.

**Impact:**
Effectively none in the common case: auth0-server-js re-encrypts the session on the first write after migration, starting its own rolling window from that point. The only edge case is if a session was near its rolling expiry but the user's last activity was recent — the new SDK would see it as fresh (because `iat` is preserved for absolute duration, but the rolling window re-starts from now). In practice this means a session that was about to expire due to inactivity gets a reprieve, which is the more permissive direction.

---

### Gap 6 — `signSessionStoreCookie: false` (default) still triggers signature-strip attempt (Informational)

When the raw cookie value contains a dot (e.g., a custom session ID generator produced `abc.def`), the stateful store's `get()` will attempt signature verification, fail for all secrets, then fall back to the raw value as the store key. This fallback is correct, but it means there is a small overhead of one HKDF + HMAC per legacy secret for every such session ID on every request.

**Impact:** Performance only. No correctness issue.

**Mitigation:** If the application never used signed cookies, set `legacySecret` to a single value so the fallback loop runs only once.

---

## Configuration Checklist for Migration

The following table summarises the express-openid-connect options that require a corresponding setting in `@auth0/auth0-express`:

| express-openid-connect option | auth0-express equivalent | Notes |
|-------------------------------|--------------------------|-------|
| `session.name` (default `'appSession'`) | `sessionConfiguration.cookie.name` | **Must match.** This is the most common cause of migration failure. |
| `secret` (string or array) | `sessionSecret` (main) + `legacyCompatibility.legacySecret` | If the secret changed at migration, put the new one in `sessionSecret` and the old one(s) in `legacySecret`. If unchanged, `legacySecret` can be omitted. |
| `session.rolling` | `sessionConfiguration.rolling` | |
| `session.rollingDuration` | `sessionConfiguration.rollingDuration` | |
| `session.absoluteDuration` | `sessionConfiguration.absoluteDuration` | |
| `session.cookie.sameSite` | `sessionConfiguration.cookie.sameSite` | |
| `session.cookie.secure` | `sessionConfiguration.cookie.secure` | |
| `session.cookie.httpOnly` | `sessionConfiguration.cookie.httpOnly` | |
| `session.cookie.domain` | `sessionConfiguration.cookie.domain` | |
| `session.cookie.path` | `sessionConfiguration.cookie.path` | Cookie path must match for the browser to send the legacy cookie. |
| `session.store` | `sessionStore` (wrapped as `AbstractDataStore`) | See Gap 2 above. |
| `signSessionStoreCookie: true` | `legacyCompatibility.legacySecret` | The signing key is derived from the same `secret`; set `legacySecret` to the old secret so signature verification works. |
| `baseURL` (determines `secure` flag) | `appBaseUrl` | |

---

## Minimum Working Migration Example (Stateless)

```typescript
import { createAuth0, requireAuth } from '@auth0/auth0-express';

const { auth0, requireAuth } = createAuth0({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  appBaseUrl: process.env.APP_BASE_URL!,

  // Must match the old express-openid-connect session.name (default 'appSession')
  sessionSecret: process.env.SESSION_SECRET!,
  sessionConfiguration: {
    cookie: { name: 'appSession' },
  },

  legacyCompatibility: {
    enabled: true,
    // If the secret is unchanged, this can be omitted — it defaults to sessionSecret.
    legacySecret: process.env.SESSION_SECRET,
    // Optional: set audience/scope to match what was used in express-openid-connect
    legacyAudience: process.env.AUTH0_AUDIENCE ?? 'default',
    legacyScope: 'openid profile email offline_access',
  },
});
```

## Minimum Working Migration Example (Stateful / Redis)

```typescript
import { createAuth0 } from '@auth0/auth0-express';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

// Promise-based AbstractDataStore wrapper around the existing Redis instance
class RedisDataStore {
  constructor(private readonly client: typeof redisClient) {}
  async get(key: string) {
    const raw = await this.client.get(key);
    return raw ? JSON.parse(raw) : undefined;
  }
  async set(key: string, value: unknown, expiresAt?: number) {
    const ttlSec = expiresAt ? expiresAt - Math.floor(Date.now() / 1000) : undefined;
    const s = JSON.stringify(value);
    ttlSec && ttlSec > 0 ? await this.client.set(key, s, { EX: ttlSec }) : await this.client.set(key, s);
  }
  async delete(key: string) { await this.client.del(key); }
}

const { auth0, requireAuth } = createAuth0({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  appBaseUrl: process.env.APP_BASE_URL!,

  sessionSecret: process.env.SESSION_SECRET!,
  sessionStore: new RedisDataStore(redisClient),
  sessionConfiguration: {
    cookie: { name: 'appSession' },   // must match the old session.name
  },

  legacyCompatibility: {
    enabled: true,
    legacySecret: process.env.SESSION_SECRET,
  },
});
```

---

## Summary

| # | Gap | Severity | Action required |
|---|-----|----------|-----------------|
| 1 | Cookie name must be set to match old `session.name` | **Critical** | Set `sessionConfiguration.cookie.name` |
| 2 | Session store interface is callback-based (connect-session) vs. promise-based | **Critical** for stateful | Write a promise-based `AbstractDataStore` wrapper |
| 3 | Backchannel logout tokens not carried over | Medium | Wait for TTL expiry, rotate secret, or add custom middleware |
| 4 | In-flight OAuth transactions fail at cutover | Low / Expected | Deploy during low-traffic window |
| 5 | Rolling `uat` not preserved; window re-starts from migration | Low | Acceptable behaviour; document to stakeholders if needed |
| 6 | Dot-containing unsigned session IDs incur signature-strip overhead | Informational | No action needed unless performance-sensitive |
