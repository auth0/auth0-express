/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { MigrationStatelessStateStore } from './legacy-compatible-stateless-state-store.js';
import { ExpressCookieHandler } from './express-cookie-handler.js';
import { EncryptJWT } from 'jose';
import type { StateData } from '@auth0/auth0-server-js';

describe('MigrationStatelessStateStore', () => {
  const secret = 'test-secret-at-least-32-characters-long';
  const cookieHandler = new ExpressCookieHandler();

  // Sample JWT tokens for testing
  const sampleIdToken = createTestJWT({
    sub: 'auth0|123456',
    sid: 'test-session-id',
    name: 'Test User',
    email: 'test@example.com',
    iss: 'https://tenant.auth0.com/',
    aud: 'test-client-id',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  describe('constructor', () => {
    it('should create store with legacy secret, audience, and scope', () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: 'legacy-secret',
          legacyAudience: 'https://api.test.com',
          legacyScope: 'openid profile email',
        },
        cookieHandler
      );

      expect(store).toBeInstanceOf(MigrationStatelessStateStore);
    });

    it('should use same secret for legacy if not provided', () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacyAudience: 'https://api.test.com',
        },
        cookieHandler
      );

      expect(store).toBeInstanceOf(MigrationStatelessStateStore);
    });

    it('should use default audience and scope if not provided', () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
        },
        cookieHandler
      );

      expect(store).toBeInstanceOf(MigrationStatelessStateStore);
    });
  });

  describe('decrypt', () => {
    it('should decrypt modern auth0-server-js sessions normally', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacyAudience: 'https://api.test.com',
        },
        cookieHandler
      );

      // Create a modern session
      const modernSession: StateData = {
        user: {
          sub: 'auth0|123456',
          name: 'Modern User',
        },
        idToken: sampleIdToken,
        refreshToken: 'modern-refresh-token',
        tokenSets: [
          {
            audience: 'https://api.test.com',
            scope: 'openid profile email',
            accessToken: 'modern-access-token',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        internal: {
          sid: 'modern-session-id',
          createdAt: Math.floor(Date.now() / 1000),
        },
      };

      // Encrypt using the modern method
      const maxAge = 3600;
      const expiration = Math.floor(Date.now() / 1000 + maxAge);
      const encrypted = await (store as any).encrypt('test-identifier', modernSession, expiration);

      // Decrypt and verify
      const decrypted = await (store as any).decrypt('test-identifier', encrypted);

      expect(decrypted).toBeDefined();
      expect(decrypted.user?.name).toBe('Modern User');
      expect(decrypted.tokenSets[0].accessToken).toBe('modern-access-token');
    });

    it('should fall back to legacy decryption when modern decryption fails', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret, // Same secret for testing
          legacyAudience: 'https://api.test.com',
        },
        cookieHandler
      );

      // Create a legacy express-openid-connect encrypted session
      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'legacy-access-token',
        refresh_token: 'legacy-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      // Encrypt using legacy A256GCM method
      const legacyEncrypted = await encryptLegacy(legacySession, secret);

      // Manually call decrypt with the legacy encrypted data
      const decrypted = await (store as any).decrypt('test-identifier', legacyEncrypted);

      expect(decrypted).toBeDefined();
      expect(decrypted.user).toBeDefined();
      expect(decrypted.user.sub).toBe('auth0|123456');
      expect(decrypted.idToken).toBe(sampleIdToken);
      expect(decrypted.refreshToken).toBe('legacy-refresh-token');
      expect(decrypted.tokenSets).toHaveLength(1);
      expect(decrypted.tokenSets[0].accessToken).toBe('legacy-access-token');
      expect(decrypted.tokenSets[0].audience).toBe('https://api.test.com');
    });

    // Cross-checks our key derivation against the REAL express-openid-connect library: derive the
    // A256GCM content-encryption key with eoc's own `encryption()` (independent `crypto.hkdfSync`),
    // encrypt with it, and confirm our store decrypts it through the public `get()`. Guards against
    // silent drift in the HKDF salt/info or the enc/alg pair — if our `deriveHkdfKey` diverged from
    // eoc's, this would fail.
    it('decrypts a cookie encrypted with the real express-openid-connect CEK derivation', async () => {
      // Deep import into eoc internals; the package ships no types for lib/.
      // @ts-expect-error - no declaration file for express-openid-connect/lib/crypto.js
      const { encryption } = await import('express-openid-connect/lib/crypto.js');
      const { CompactEncrypt } = await import('jose');

      const legacySession = { id_token: sampleIdToken, access_token: 'real-eoc-access-token' };
      const now = Math.floor(Date.now() / 1000);
      // eoc derives the CEK via crypto.hkdfSync and stores iat/uat/exp in the JWE protected header.
      const key = new Uint8Array(encryption(secret));
      const realEncrypted = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(legacySession)))
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', iat: now, uat: now, exp: now + 3600 })
        .encrypt(key);

      // Drive the public get(): the base StatelessStateStore reads the (chunked) cookie via the
      // handler, then calls the protected decrypt override.
      const cookieName = 'appSession';
      const cookies: Record<string, string> = { [`${cookieName}.0`]: realEncrypted };
      const mockHandler = {
        getCookie: (name: string) => cookies[name],
        getCookies: () => cookies,
        setCookie: vi.fn(),
        deleteCookie: vi.fn(),
      };
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
          legacyAudience: 'https://api.test.com',
          sessionConfiguration: { cookie: { name: cookieName } },
        },
        mockHandler
      );

      const result = await store.get(cookieName, {});

      expect(result).toBeDefined();
      expect(result!.user!.sub).toBe('auth0|123456');
      expect(result!.tokenSets[0]!.accessToken).toBe('real-eoc-access-token');
    });

    it('should transform legacy session format correctly', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
          legacyAudience: 'https://api.example.com',
        },
        cookieHandler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'Bearer',
        expires_at: 1234567890,
      };

      const legacyEncrypted = await encryptLegacy(legacySession, secret);
      const transformed = await (store as any).decrypt('test-id', legacyEncrypted);

      // Verify transformation
      expect(transformed.user.sub).toBe('auth0|123456');
      expect(transformed.user.name).toBe('Test User');
      expect(transformed.user.email).toBe('test@example.com');
      expect(transformed.idToken).toBe(sampleIdToken);
      expect(transformed.refreshToken).toBe('test-refresh-token');
      expect(transformed.tokenSets[0].audience).toBe('https://api.example.com');
      expect(transformed.tokenSets[0].accessToken).toBe('test-access-token');
      expect(transformed.tokenSets[0].expiresAt).toBe(1234567890);
      expect(transformed.internal.sid).toBe('test-session-id');
      expect(transformed.internal.createdAt).toBeGreaterThan(0);
    });

    it('should handle legacy session without refresh token', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
        },
        cookieHandler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        expires_at: 1234567890,
      };

      const legacyEncrypted = await encryptLegacy(legacySession, secret);
      const transformed = await (store as any).decrypt('test-id', legacyEncrypted);

      expect(transformed.refreshToken).toBeUndefined();
      expect(transformed.idToken).toBe(sampleIdToken);
    });

    it('should handle legacy session without access token', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
        },
        cookieHandler
      );

      const legacySession = {
        id_token: sampleIdToken,
        refresh_token: 'test-refresh-token',
      };

      const legacyEncrypted = await encryptLegacy(legacySession, secret);
      const transformed = await (store as any).decrypt('test-id', legacyEncrypted);

      expect(transformed.tokenSets).toEqual([]);
      expect(transformed.refreshToken).toBe('test-refresh-token');
    });

    it('should preserve custom properties from legacy session', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
        },
        cookieHandler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        expires_at: 1234567890,
        customProperty: 'custom-value',
        nestedCustom: { foo: 'bar' },
      };

      const legacyEncrypted = await encryptLegacy(legacySession, secret);
      const transformed = await (store as any).decrypt('test-id', legacyEncrypted);

      expect(transformed.customProperty).toBe('custom-value');
      expect(transformed.nestedCustom).toEqual({ foo: 'bar' });
    });

    it('should handle expires_at as string', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
        },
        cookieHandler
      );

      const legacySession = {
        access_token: 'test-access-token',
        expires_at: '1234567890',
      };

      const legacyEncrypted = await encryptLegacy(legacySession, secret);
      const transformed = await (store as any).decrypt('test-id', legacyEncrypted);

      expect(transformed.tokenSets[0].expiresAt).toBe(1234567890);
    });

    it('should use legacyScope when transforming sessions', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
          legacyAudience: 'https://api.example.com',
          legacyScope: 'openid profile email read:data',
        },
        cookieHandler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        expires_at: 1234567890,
      };

      const legacyEncrypted = await encryptLegacy(legacySession, secret);
      const transformed = await (store as any).decrypt('test-id', legacyEncrypted);

      expect(transformed.tokenSets[0].scope).toBe('openid profile email read:data');
      expect(transformed.tokenSets[0].audience).toBe('https://api.example.com');
    });

    it('should use default scope when legacyScope not provided', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
          legacyAudience: 'https://api.example.com',
        },
        cookieHandler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        expires_at: 1234567890,
      };

      const legacyEncrypted = await encryptLegacy(legacySession, secret);
      const transformed = await (store as any).decrypt('test-id', legacyEncrypted);

      expect(transformed.tokenSets[0].scope).toBe('openid profile email offline_access');
    });

    it('should return undefined when both modern and legacy decryption fail', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: 'different-secret',
        },
        cookieHandler
      );

      const invalidEncrypted = 'invalid-encrypted-data';

      const result = await (store as any).decrypt('test-id', invalidEncrypted);
      expect(result).toBeUndefined();
    });

    it('returns undefined (does not throw) for an undecryptable modern-format cookie', async () => {
      // A cookie encrypted under a DIFFERENT modern secret is a genuine 5-segment
      // A256CBC-HS512 JWE that this store cannot decrypt. The base StatelessStateStore
      // returns undefined ("logged out") in this case; the migration store must match it
      // rather than routing the modern ciphertext into the A256GCM-only legacy path (which
      // throws JOSEAlgNotAllowed and would surface as a 500 from getUser/getSession).
      const otherSecret = 'a-completely-different-secret-32-chars-xx';
      const maker = new MigrationStatelessStateStore({ secret: otherSecret }, cookieHandler);
      const modernSession: StateData = {
        user: { sub: 'auth0|123456' },
        idToken: undefined,
        refreshToken: 'r',
        tokenSets: [],
        internal: { sid: 's', createdAt: Math.floor(Date.now() / 1000) },
      };
      const foreignCookie = await (maker as any).encrypt('appSession', modernSession, Math.floor(Date.now() / 1000) + 3600);
      expect(foreignCookie.split('.').length).toBe(5);

      const store = new MigrationStatelessStateStore({ secret, legacySecret: secret }, cookieHandler);

      const result = await (store as any).decrypt('appSession', foreignCookie);
      expect(result).toBeUndefined();
    });

    it('returns undefined (does not throw) for an expired modern-format cookie', async () => {
      // An expired modern cookie throws JWTExpired from the base decrypt (not a decryption
      // failure). The migration store must still resolve to undefined, not fall into the
      // legacy path and throw JOSEAlgNotAllowed.
      const store = new MigrationStatelessStateStore({ secret, legacySecret: secret }, cookieHandler);
      const modernSession: StateData = {
        user: { sub: 'auth0|123456' },
        idToken: undefined,
        refreshToken: 'r',
        tokenSets: [],
        internal: { sid: 's', createdAt: Math.floor(Date.now() / 1000) },
      };
      const expiredCookie = await (store as any).encrypt('appSession', modernSession, Math.floor(Date.now() / 1000) - 3600);
      expect(expiredCookie.split('.').length).toBe(5);

      const result = await (store as any).decrypt('appSession', expiredCookie);
      expect(result).toBeUndefined();
    });

    it('supports an array secret for rotation (decrypts a modern cookie made with the old secret)', async () => {
      const oldSecret = 'old-modern-secret-at-least-32-characters!';
      const newSecret = 'new-modern-secret-at-least-32-characters!';

      // Cookie was written under the old secret before rotation.
      const maker = new MigrationStatelessStateStore({ secret: oldSecret }, cookieHandler);
      const modernSession: StateData = {
        user: { sub: 'auth0|rotated' },
        idToken: undefined,
        refreshToken: 'r',
        tokenSets: [],
        internal: { sid: 's', createdAt: Math.floor(Date.now() / 1000) },
      };
      const cookie = await (maker as any).encrypt('appSession', modernSession, Math.floor(Date.now() / 1000) + 3600);

      // After rotating to [new, old], the old-secret cookie must still decrypt.
      const store = new MigrationStatelessStateStore({ secret: [newSecret, oldSecret] }, cookieHandler);

      const result = await (store as any).decrypt('appSession', cookie);
      expect(result?.user?.sub).toBe('auth0|rotated');
    });

    it('should propagate non-decryption errors instead of silently swallowing them', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
        },
        cookieHandler
      );

      const legacySession = { id_token: sampleIdToken, access_token: 'token' };
      const legacyEncrypted = await encryptLegacy(legacySession, secret);

      // Corrupt the Web Crypto API so #deriveLegacyKey throws a TypeError — a programming
      // error that should never be silently swallowed.
      vi.spyOn(crypto.subtle, 'importKey').mockImplementationOnce(() => {
        throw new TypeError('simulated crypto failure');
      });

      await expect((store as any).decrypt('test-id', legacyEncrypted)).rejects.toThrow(TypeError);

      vi.restoreAllMocks();
    });

    it('should decrypt with second secret when key rotation is used', async () => {
      const oldSecret = 'old-secret-that-is-at-least-32-chars-long!';
      const newSecret = 'new-secret-that-is-at-least-32-chars-long!';

      // Create store with only the new secret as main + old secret in rotation array
      const store = new MigrationStatelessStateStore(
        {
          secret: newSecret,
          legacySecret: [newSecret, oldSecret],
          legacyAudience: 'https://api.test.com',
        },
        cookieHandler
      );

      // Encrypt session with old secret
      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'rotated-access-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      const legacyEncrypted = await encryptLegacy(legacySession, oldSecret);

      // Should decrypt successfully using the old secret from the rotation array
      const decrypted = await (store as any).decrypt('test-identifier', legacyEncrypted);

      expect(decrypted).toBeDefined();
      expect(decrypted.tokenSets[0].accessToken).toBe('rotated-access-token');
    });

    it('should decrypt with first secret in array when it matches', async () => {
      const firstSecret = 'first-secret-at-least-32-characters-long';
      const secondSecret = 'second-secret-at-least-32-characters-long';

      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: [firstSecret, secondSecret],
          legacyAudience: 'https://api.test.com',
        },
        cookieHandler
      );

      // Encrypt with first secret
      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'first-secret-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      const legacyEncrypted = await encryptLegacy(legacySession, firstSecret);

      const decrypted = await (store as any).decrypt('test-identifier', legacyEncrypted);

      expect(decrypted).toBeDefined();
      expect(decrypted.tokenSets[0].accessToken).toBe('first-secret-token');
    });

    it('should return undefined for an expired legacy session (header-level exp)', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
        },
        cookieHandler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'expired-access-token',
      };
      const expiredEncrypted = await encryptLegacyWithHeaderExp(legacySession, secret, Math.floor(Date.now() / 1000) - 3600);

      const result = await (store as any).decrypt('test-id', expiredEncrypted);
      expect(result).toBeUndefined();
    });

    it('should reject a legacy session whose header exp equals now (exp <= now parity)', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
        },
        cookieHandler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'boundary-access-token',
      };
      // express-openid-connect treats a session invalid once `exp <= now` (`assert(exp > epoch())`),
      // so a cookie whose exp is exactly the current second must be rejected, not accepted for one
      // extra second.
      const boundaryEncrypted = await encryptLegacyWithHeaderExp(legacySession, secret, Math.floor(Date.now() / 1000));

      const result = await (store as any).decrypt('test-id', boundaryEncrypted);
      expect(result).toBeUndefined();
    });

    it('should return undefined for a legacy session with no header-level exp', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
        },
        cookieHandler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'no-exp-access-token',
      };
      // A cookie lacking a header-level exp must be rejected, mirroring express-openid-connect's
      // `exp > epoch()` assertion — never accepted as a non-expiring session.
      const noExpEncrypted = await encryptLegacyWithoutHeaderExp(legacySession, secret);

      const result = await (store as any).decrypt('test-id', noExpEncrypted);
      expect(result).toBeUndefined();
    });

    it('uses the JWE header iat as internal.createdAt', async () => {
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
          legacyAudience: 'https://api.test.com',
        },
        cookieHandler
      );

      // A recent iat (within the default absoluteDuration) so the store returns the session; this
      // test pins the iat -> createdAt mapping, not the cap enforcement covered elsewhere.
      const headerIat = Math.floor(Date.now() / 1000) - 3600;
      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'iat-token',
      };
      const encrypted = await encryptLegacyWithHeaderIat(
        legacySession,
        secret,
        headerIat,
        Math.floor(Date.now() / 1000) + 3600
      );

      const decrypted = await (store as any).decrypt('test-id', encrypted);

      expect(decrypted).toBeDefined();
      expect(decrypted.internal.createdAt).toBe(headerIat);
    });
  });

  describe('get/set - absoluteDuration and the migrated session age', () => {
    // Mirrors the MigrationStatefulStateStore coverage for the cookie-only (stateless) path.
    // A migrated session keeps its original express-openid-connect `iat` as `createdAt`, and the
    // base store expires it at `createdAt + absoluteDuration`. express-openid-connect defaults
    // absoluteDuration to 7 days, this SDK to 3. If the app does not raise absoluteDuration to at
    // least the old value, a legacy session already older than 3 days decrypts successfully but the
    // re-encrypting write emits a maxAge<=0 cookie the browser immediately drops — a silent logout.
    // Unlike the stateful store (which writes back eagerly on read), the stateless store computes
    // maxAge on `set`, so the flow here is get() to load the aged session, then set() it back.
    const FOUR_DAYS = 4 * 24 * 60 * 60;
    const cookieName = 'appSession';

    const agedLegacyCookie = async () => {
      const now = Math.floor(Date.now() / 1000);
      // Issued 4 days ago, but still valid under express-openid-connect (header exp in the future).
      return await encryptLegacyWithHeaderIat(
        { id_token: sampleIdToken, access_token: 'aged-token' },
        secret,
        now - FOUR_DAYS,
        now + 3600
      );
    };

    const mockHandlerWithCookie = (cookieValue: string) => {
      const cookies: Record<string, string> = { [`${cookieName}.0`]: cookieValue };
      return {
        getCookie: (name: string) => cookies[name],
        getCookies: () => cookies,
        setCookie: vi.fn(),
        deleteCookie: vi.fn(),
      };
    };

    it('returns no session for a >3-day-old legacy session under the default (3-day) absoluteDuration', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handler = mockHandlerWithCookie(await agedLegacyCookie());
      const store = new MigrationStatelessStateStore(
        { secret, legacySecret: secret, sessionConfiguration: { cookie: { name: cookieName } } },
        handler
      );

      // The cookie decrypts (it was valid under express-openid-connect), but it is already past this
      // SDK's absoluteDuration. A migrated cookie still carries eoc's own Max-Age, so the browser
      // keeps sending it — the store must enforce the cap on read and return no session rather than
      // honoring it until some later write.
      const result = await store.get(cookieName, {});
      expect(result).toBeUndefined();

      warn.mockRestore();
    });

    it('keeps a >3-day-old legacy session alive when absoluteDuration matches express-openid-connect', async () => {
      const handler = mockHandlerWithCookie(await agedLegacyCookie());
      const store = new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
          sessionConfiguration: { cookie: { name: cookieName }, absoluteDuration: 604800 },
        },
        handler
      );

      const result = await store.get(cookieName, {});
      expect(result).toBeDefined();

      await store.set(cookieName, result!, false, {});
      expect(handler.setCookie).toHaveBeenCalled();
      const emittedMaxAge = handler.setCookie.mock.calls[0]![2]!.maxAge;
      // Raising the absolute cap to 7 days keeps `createdAt + absoluteDuration` in the future, so
      // the rolling inactivity window (1 day) governs and the cookie survives instead of expiring.
      expect(emittedMaxAge).toBeGreaterThan(0);
    });

    it('read-rejection and write-drop agree on the same aged createdAt', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handler = mockHandlerWithCookie(await agedLegacyCookie());
      const store = new MigrationStatelessStateStore(
        { secret, legacySecret: secret, sessionConfiguration: { cookie: { name: cookieName } } },
        handler
      );

      // Read rejects the aged session...
      const result = await store.get(cookieName, {});
      expect(result).toBeUndefined();

      // ...and a write of state carrying that same aged createdAt would emit a Max-Age<=0 cookie the
      // browser drops. So there is no state the write path keeps alive while the read path logs out:
      // both are driven by calculateMaxAge(createdAt) and agree in the safe (expired) direction.
      const agedCreatedAt = Math.floor(Date.now() / 1000) - FOUR_DAYS;
      const agedStateData: StateData = {
        user: { sub: 'auth0|123456' },
        idToken: sampleIdToken,
        refreshToken: undefined,
        tokenSets: [],
        internal: { sid: 'aged-sid', createdAt: agedCreatedAt },
      };

      await store.set(cookieName, agedStateData, false, {});
      expect(handler.setCookie).toHaveBeenCalled();
      const emittedMaxAge = handler.setCookie.mock.calls[0]![2]!.maxAge;
      expect(emittedMaxAge).toBe(0);

      warn.mockRestore();
    });

    it('warns once at construction when absoluteDuration is left unset', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      new MigrationStatelessStateStore(
        { secret, legacySecret: secret, sessionConfiguration: { cookie: { name: cookieName } } },
        mockHandlerWithCookie('')
      );

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('without sessionConfiguration.absoluteDuration'));

      warn.mockRestore();
    });

    it('does not warn at construction when absoluteDuration is set explicitly', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      new MigrationStatelessStateStore(
        {
          secret,
          legacySecret: secret,
          sessionConfiguration: { cookie: { name: cookieName }, absoluteDuration: 604800 },
        },
        mockHandlerWithCookie('')
      );

      expect(warn).not.toHaveBeenCalled();

      warn.mockRestore();
    });
  });
});

/**
 * Encrypts data using express-openid-connect's encryption method with a custom header exp
 */
async function encryptLegacyWithHeaderExp(
  payload: Record<string, unknown>,
  secret: string,
  exp: number
): Promise<string> {
  const BYTE_LENGTH = 32;
  const ENCRYPTION_INFO = 'JWE CEK';
  const DIGEST = 'SHA-256';

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: DIGEST,
      info: encoder.encode(ENCRYPTION_INFO),
      salt: new Uint8Array(0),
    },
    keyMaterial,
    BYTE_LENGTH * 8
  );

  const encryptionKey = new Uint8Array(derivedBits);

  return await new EncryptJWT(payload)
    .setProtectedHeader({ enc: 'A256GCM', alg: 'dir', exp } as any)
    .setIssuedAt()
    .encrypt(encryptionKey);
}

/**
 * Encrypts data with NO exp in the JWE protected header, to exercise the store's rejection of
 * cookies that lack a header-level exp (a genuine express-openid-connect cookie always carries one).
 */
async function encryptLegacyWithoutHeaderExp(payload: Record<string, unknown>, secret: string): Promise<string> {
  const BYTE_LENGTH = 32;
  const ENCRYPTION_INFO = 'JWE CEK';
  const DIGEST = 'SHA-256';

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: DIGEST,
      info: encoder.encode(ENCRYPTION_INFO),
      salt: new Uint8Array(0),
    },
    keyMaterial,
    BYTE_LENGTH * 8
  );

  const encryptionKey = new Uint8Array(derivedBits);

  return await new EncryptJWT(payload).setProtectedHeader({ enc: 'A256GCM', alg: 'dir' }).encrypt(encryptionKey);
}

/**
 * Encrypts data with iat AND exp in the JWE protected header, matching how
 * express-openid-connect actually writes cookies (header-level iat/exp, not payload).
 */
async function encryptLegacyWithHeaderIat(
  payload: Record<string, unknown>,
  secret: string,
  iat: number,
  exp: number
): Promise<string> {
  const BYTE_LENGTH = 32;
  const ENCRYPTION_INFO = 'JWE CEK';
  const DIGEST = 'SHA-256';

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: DIGEST,
      info: encoder.encode(ENCRYPTION_INFO),
      salt: new Uint8Array(0),
    },
    keyMaterial,
    BYTE_LENGTH * 8
  );

  const encryptionKey = new Uint8Array(derivedBits);

  return await new EncryptJWT(payload)
    .setProtectedHeader({ enc: 'A256GCM', alg: 'dir', iat, exp } as any)
    .encrypt(encryptionKey);
}

/**
 * Helper to create a test JWT token
 */
function createTestJWT(payload: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = 'test-signature';
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64UrlEncode(str: string): string {
  const base64 = Buffer.from(str).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Encrypts data using express-openid-connect's encryption method (A256GCM with HKDF)
 */
async function encryptLegacy(payload: Record<string, unknown>, secret: string): Promise<string> {
  const BYTE_LENGTH = 32;
  const ENCRYPTION_INFO = 'JWE CEK';
  const DIGEST = 'SHA-256';

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: DIGEST,
      info: encoder.encode(ENCRYPTION_INFO),
      salt: new Uint8Array(0),
    },
    keyMaterial,
    BYTE_LENGTH * 8
  );

  const encryptionKey = new Uint8Array(derivedBits);

  // express-openid-connect stores iat/uat/exp in the JWE protected header (not the payload
  // claims), and asserts `exp > epoch()` on read. Mirror that here so the fixture matches the
  // real cookie format and exercises the store's header-level exp check.
  const now = Math.floor(Date.now() / 1000);
  return await new EncryptJWT(payload)
    .setProtectedHeader({ enc: 'A256GCM', alg: 'dir', iat: now, uat: now, exp: now + 7200 } as any)
    .encrypt(encryptionKey);
}
