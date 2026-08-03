import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationStatefulStateStore } from './legacy-compatible-stateful-state-store.js';
import type { CookieHandler, AbstractDataStore } from '@auth0/auth0-server-js';
import { LegacySessionTransformer } from './legacy-session-transformer.js';

/**
 * Creates a JWS-signed cookie value matching the express-openid-connect format.
 */
async function createSignedCookie(cookieName: string, sessionId: string, secret: string): Promise<string> {
  const BYTE_LENGTH = 32;
  const SIGNING_INFO = 'JWS Cookie Signing';
  const DIGEST = 'SHA-256';

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: DIGEST,
      info: encoder.encode(SIGNING_INFO),
      salt: new Uint8Array(0),
    },
    keyMaterial,
    BYTE_LENGTH * 8
  );
  const keyBytes = new Uint8Array(derivedBits);

  const HEADER_B64 = 'eyJhbGciOiJIUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il19';
  const rawPayload = encoder.encode(`${cookieName}=${sessionId}`);
  const headerBytes = encoder.encode(HEADER_B64 + '.');
  const signingInput = new Uint8Array(headerBytes.length + rawPayload.length);
  signingInput.set(headerBytes, 0);
  signingInput.set(rawPayload, headerBytes.length);

  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, signingInput);
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${sessionId}.${sigB64}`;
}

const secret = 'test-secret-key-that-is-long-enough';

class MockStore implements AbstractDataStore<unknown> {
  private storage = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.storage.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  keys(): string[] {
    return [...this.storage.keys()];
  }
}

const sampleIdToken =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdXRoMHwxMjM0NTYiLCJuYW1lIjoiSm9obiBEb2UiLCJlbWFpbCI6ImpvaG5AZXhhbXBsZS5jb20iLCJpYXQiOjE1MTYyMzkwMjJ9.dummy';

function createFutureLegacyPayload(overrides?: Partial<{ data: Record<string, unknown> }>) {
  const now = Math.floor(Date.now() / 1000);
  return {
    header: { iat: now - 100, uat: now - 50, exp: now + 3600 },
    data: {
      id_token: sampleIdToken,
      access_token: 'legacy-access-token',
      refresh_token: 'legacy-refresh-token',
      expires_at: now + 3600,
      ...overrides?.data,
    },
    cookie: { expires: now + 3600, maxAge: 3600 },
  };
}

describe('MigrationStatefulStateStore', () => {
  let mockStore: MockStore;

  beforeEach(() => {
    mockStore = new MockStore();
    vi.clearAllMocks();
  });

  const createCookieHandler = (): CookieHandler<Record<string, unknown>> => ({
    getCookie: vi.fn(),
    setCookie: vi.fn(),
    deleteCookie: vi.fn(),
    getCookies: vi.fn().mockReturnValue({}),
  });

  describe('constructor', () => {
    it('should create store with legacy audience and scope', () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.test.com',
          legacyScope: 'openid profile email',
        },
        handler
      );

      expect(store).toBeInstanceOf(MigrationStatefulStateStore);
    });

    it('should use default audience and scope if not provided', () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      expect(store).toBeInstanceOf(MigrationStatefulStateStore);
    });
  });

  describe('get - legacy session with plain text session ID', () => {
    it('should handle plain text session ID cookie from express-openid-connect', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.example.com',
          legacyScope: 'openid profile email',
        },
        handler
      );

      const plainSessionId = 'sess:abc123def456';
      const legacySessionData = createFutureLegacyPayload();

      await mockStore.set(plainSessionId, legacySessionData);
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(plainSessionId);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.user).toBeDefined();
      expect(result!.user!.sub).toBe('auth0|123456');
      expect(result!.idToken).toBe(sampleIdToken);
      expect(result!.refreshToken).toBe('legacy-refresh-token');
      expect(result!.tokenSets).toHaveLength(1);
      expect(result!.tokenSets[0]!.accessToken).toBe('legacy-access-token');
      expect(result!.tokenSets[0]!.audience).toBe('https://api.example.com');
      expect(result!.tokenSets[0]!.scope).toBe('openid profile email');
    });

    it('should return undefined for expired legacy sessions', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      const plainSessionId = 'sess:expired';
      const expiredPayload = {
        header: { iat: 1000, uat: 1000, exp: 1000 },
        data: {
          id_token: sampleIdToken,
          access_token: 'expired-token',
          expires_at: 1000,
        },
        cookie: { expires: 1000, maxAge: 3600 },
      };

      await mockStore.set(plainSessionId, expiredPayload);
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(plainSessionId);

      const result = await store.get('__a0_session', {});

      expect(result).toBeUndefined();
    });

    it('should reject a legacy session whose header exp equals now (exp <= now parity)', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      const nowSeconds = Math.floor(Date.now() / 1000);
      const plainSessionId = 'sess:boundary';
      // express-openid-connect treats a session invalid once `exp <= now` (`assert(exp > epoch())`),
      // so a payload whose exp is exactly the current second must be rejected, not accepted for one
      // extra second.
      const boundaryPayload = {
        header: { iat: nowSeconds - 100, uat: nowSeconds - 50, exp: nowSeconds },
        data: {
          id_token: sampleIdToken,
          access_token: 'boundary-token',
          expires_at: nowSeconds,
        },
        cookie: { expires: nowSeconds, maxAge: 3600 },
      };

      await mockStore.set(plainSessionId, boundaryPayload);
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(plainSessionId);

      const result = await store.get('__a0_session', {});

      expect(result).toBeUndefined();
    });

    it('should not treat a payload with a non-numeric exp as a valid legacy session', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      const plainSessionId = 'sess:malformed-exp';
      // A non-numeric exp must not slip past the expiry check: `'never' < now` coerces to false and
      // would otherwise read as "not expired". The store must not surface it as a live session.
      const malformedPayload = {
        header: { iat: 1000, uat: 1000, exp: 'never' },
        data: { id_token: sampleIdToken, access_token: 'malformed-token' },
        cookie: { expires: 1000, maxAge: 3600 },
      };

      await mockStore.set(plainSessionId, malformedPayload as never);
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(plainSessionId);

      const result = await store.get('__a0_session', {});

      expect(result?.tokenSets?.[0]?.accessToken).not.toBe('malformed-token');
    });
  });

  describe('legacy transformation logic (via LegacySessionTransformer)', () => {
    const transformer = new LegacySessionTransformer('https://api.example.com', 'openid profile email read:data');

    it('should transform legacy session to modern format', () => {
      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_at: 1234567890,
        customField: 'custom-value',
      };

      const result = transformer.transformLegacySession(legacySession);

      expect(result.user).toBeDefined();
      expect(result.user!.sub).toBe('auth0|123456');
      expect(result.user!.name).toBe('John Doe');
      expect(result.idToken).toBe(sampleIdToken);
      expect(result.refreshToken).toBe('test-refresh-token');
      expect(result.tokenSets).toHaveLength(1);
      expect(result.tokenSets[0]!.accessToken).toBe('test-access-token');
      expect(result.tokenSets[0]!.audience).toBe('https://api.example.com');
      expect(result.tokenSets[0]!.scope).toBe('openid profile email read:data');
      expect(result.tokenSets[0]!.expiresAt).toBe(1234567890);
      expect(result.customField).toBe('custom-value');
    });

    it('should handle legacy sessions without access tokens', () => {
      const legacySession = { id_token: sampleIdToken };
      const result = transformer.transformLegacySession(legacySession);

      expect(result.tokenSets).toEqual([]);
      expect(result.idToken).toBe(sampleIdToken);
    });

    it('should handle expires_at as string', () => {
      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        expires_at: '1234567890',
      };

      const result = transformer.transformLegacySession(legacySession);

      expect(result.tokenSets[0]!.expiresAt).toBe(1234567890);
    });

    it('should fall back to 0 when expires_at is a non-numeric string (not NaN)', () => {
      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        expires_at: 'not-a-number',
      };

      const result = transformer.transformLegacySession(legacySession);

      // A NaN expiresAt would neither serialize nor compare sanely; 0 = already-expired.
      expect(result.tokenSets[0]!.expiresAt).toBe(0);
    });

    it('should use session-level sid over id_token sid for internal.sid', () => {
      const legacySession = {
        id_token: sampleIdToken,
        sid: 'session-level-sid',
      };

      const result = transformer.transformLegacySession(legacySession);

      expect(result.internal.sid).toBe('session-level-sid');
    });

    it('should fall back to id_token sid when no session-level sid is present', () => {
      const legacySession = {
        id_token: sampleIdToken,
      };

      const result = transformer.transformLegacySession(legacySession);

      // sampleIdToken has sub 'auth0|123456' but no sid claim — should be empty string
      expect(result.internal.sid).toBe('');
    });

    it('should not expose session-level sid as a custom property', () => {
      const legacySession = {
        id_token: sampleIdToken,
        sid: 'session-level-sid',
      };

      const result = transformer.transformLegacySession(legacySession);

      expect((result as Record<string, unknown>)['sid']).toBeUndefined();
    });
  });

  describe('get - uses header.iat for createdAt', () => {
    it('should use header.iat for createdAt when transforming legacy store payload', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      const now = Math.floor(Date.now() / 1000);
      const legacyPayload = {
        header: { iat: 1700000000, uat: 1700000001, exp: now + 3600 },
        data: {
          id_token: sampleIdToken,
          access_token: 'test-access-token',
          expires_at: now + 3600,
        },
        cookie: { expires: now + 3600, maxAge: 3600 },
      };

      const sessionId = 'sess:iat-test';
      await mockStore.set(sessionId, legacyPayload);
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(sessionId);

      const result = await store.get('__a0_session', {});

      expect(result!.internal.createdAt).toBe(1700000000);
    });
  });

  describe('signed cookie handling', () => {
    it('should use unsigned session ID after verifying JWS-signed cookie', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: secret,
          legacyAudience: 'https://api.example.com',
          legacyScope: 'openid profile email',
        },
        handler
      );

      const plainSessionId = 'sess:signed123';
      const signedCookieValue = await createSignedCookie('__a0_session', plainSessionId, secret);

      const legacySessionData = createFutureLegacyPayload({
        data: { access_token: 'signed-access-token', refresh_token: 'signed-refresh-token' },
      });

      await mockStore.set(plainSessionId, legacySessionData);
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(signedCookieValue);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.tokenSets[0]!.accessToken).toBe('signed-access-token');
    });

    // Cross-checks our verifier against a cookie signed by the REAL express-openid-connect
    // library (independent `crypto.hkdfSync` derivation), not our own `createSignedCookie`
    // helper. Guards against silent drift in the HKDF salt/info or JWS header: if our
    // derivation diverged from eoc's, this cookie would fail to verify.
    it('verifies a cookie signed by the real express-openid-connect library', async () => {
      // Deep import into eoc internals; the package ships no types for lib/.
      // @ts-expect-error - no declaration file for express-openid-connect/lib/crypto.js
      const { signing, signCookie } = await import('express-openid-connect/lib/crypto.js');

      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: secret,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      const plainSessionId = 'sess:real-eoc';
      // Build the signed cookie exactly as express-openid-connect would on the wire.
      const signingKey = signing(secret);
      const realSignedCookie = await signCookie('__a0_session', plainSessionId, signingKey);

      await mockStore.set(plainSessionId, createFutureLegacyPayload({ data: { access_token: 'real-eoc-token' } }));
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(realSignedCookie);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.tokenSets[0]!.accessToken).toBe('real-eoc-token');
    });

    it('should fall back to raw cookie value when signature is invalid', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: secret,
        },
        handler
      );

      const plainSessionId = 'sess:invalidsig';
      const invalidSignedValue = `${plainSessionId}.invalidsignatureXXX`;

      const legacySessionData = createFutureLegacyPayload({
        data: { access_token: 'fallback-token' },
      });
      await mockStore.set(invalidSignedValue, legacySessionData);

      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(invalidSignedValue);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.tokenSets[0]!.accessToken).toBe('fallback-token');
    });

    it('should handle unsigned cookie (no dot) as before', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      const plainSessionId = 'sess:nodot123';
      const legacySessionData = createFutureLegacyPayload({
        data: { access_token: 'unsigned-access-token' },
      });

      await mockStore.set(plainSessionId, legacySessionData);
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(plainSessionId);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.tokenSets[0]!.accessToken).toBe('unsigned-access-token');
    });

    it('should return undefined when signed cookie cannot be resolved and store has no matching entry', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: 'wrong-secret-that-is-long-enough-to-pass',
        },
        handler
      );

      const signedCookieValue = await createSignedCookie('__a0_session', 'sess:missing', secret);

      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(signedCookieValue);

      const result = await store.get('__a0_session', {});

      expect(result).toBeUndefined();
    });

    it('rejects a forged signature on an existing session (does not resolve the real session key)', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: secret,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      // A REAL session lives at the plain key `sess:victim`.
      const realSessionId = 'sess:victim';
      await mockStore.set(realSessionId, createFutureLegacyPayload({ data: { access_token: 'victim-token' } }));

      // Attacker presents `sess:victim.<sig>` signed with the WRONG secret.
      const forgedCookie = await createSignedCookie(
        '__a0_session',
        realSessionId,
        'attacker-secret-that-is-long-enough-xxx'
      );
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(forgedCookie);

      const result = await store.get('__a0_session', {});

      // Signature verification fails → raw fallback yields `sess:victim.<sig>`, which is NOT the
      // real key `sess:victim`, so the real session is not disclosed.
      expect(result).toBeUndefined();
    });

    it('verifies a JWS-signed legacy cookie using a rotated (older) secret from the array', async () => {
      const oldSecret = 'old-legacy-secret-at-least-32-characters';
      const newSecret = 'new-legacy-secret-at-least-32-characters';
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: [newSecret, oldSecret],
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      const sessionId = 'sess:rotated';
      // Cookie was signed with the OLD secret (pre-rotation).
      const signedCookie = await createSignedCookie('__a0_session', sessionId, oldSecret);
      await mockStore.set(sessionId, createFutureLegacyPayload({ data: { access_token: 'rotated-token' } }));
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(signedCookie);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.tokenSets[0]!.accessToken).toBe('rotated-token');
    });

    it('supports an array session secret for rotation (resolves a modern cookie made with the old secret)', async () => {
      const oldSecret = 'old-modern-secret-at-least-32-characters!';
      const newSecret = 'new-modern-secret-at-least-32-characters!';

      const modernStateData = {
        user: { sub: 'auth0|rotated' },
        idToken: undefined,
        refreshToken: 'refresh',
        tokenSets: [],
        internal: { sid: 'sid-rotated', createdAt: Math.floor(Date.now() / 1000) },
      };

      // Write a modern session under the OLD secret; capture the encrypted cookie the base emits.
      const oldHandler = createCookieHandler();
      (oldHandler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      const oldStore = new MigrationStatefulStateStore({ secret: oldSecret, store: mockStore }, oldHandler);
      await oldStore.set('__a0_session', modernStateData, false, {});
      const encryptedCookie = (oldHandler.setCookie as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as string;

      // After rotating to [new, old], reading the old-secret cookie must still resolve the session.
      const newHandler = createCookieHandler();
      (newHandler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(encryptedCookie);
      const newStore = new MigrationStatefulStateStore(
        { secret: [newSecret, oldSecret], store: mockStore },
        newHandler
      );

      const result = await newStore.get('__a0_session', {});

      expect(result).toEqual(modernStateData);
    });
  });

  describe('requireSignedLegacyCookie', () => {
    it('rejects an unsigned (plain) cookie when signing is required', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: secret,
          requireSignedLegacyCookie: true,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      // A real session lives at the plain key; an attacker who knows the id but not the
      // signing secret presents it unsigned.
      const plainSessionId = 'sess:guessable';
      await mockStore.set(plainSessionId, createFutureLegacyPayload({ data: { access_token: 'victim-token' } }));
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(plainSessionId);

      const result = await store.get('__a0_session', {});

      expect(result).toBeUndefined();
    });

    it('rejects a badly-signed cookie when signing is required (no raw fallback)', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: secret,
          requireSignedLegacyCookie: true,
        },
        handler
      );

      const plainSessionId = 'sess:invalidsig';
      const invalidSignedValue = `${plainSessionId}.invalidsignatureXXX`;
      // Store an entry under the raw value to prove the raw fallback is NOT taken.
      await mockStore.set(invalidSignedValue, createFutureLegacyPayload({ data: { access_token: 'fallback-token' } }));
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(invalidSignedValue);

      const result = await store.get('__a0_session', {});

      expect(result).toBeUndefined();
    });

    it('accepts a validly-signed cookie when signing is required', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: secret,
          requireSignedLegacyCookie: true,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      const plainSessionId = 'sess:properly-signed';
      const signedCookieValue = await createSignedCookie('__a0_session', plainSessionId, secret);
      await mockStore.set(plainSessionId, createFutureLegacyPayload({ data: { access_token: 'signed-token' } }));
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(signedCookieValue);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.tokenSets[0]!.accessToken).toBe('signed-token');
    });

    it('still honors an unsigned cookie by default (requireSignedLegacyCookie unset)', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: secret,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      const plainSessionId = 'sess:default-unsigned';
      await mockStore.set(plainSessionId, createFutureLegacyPayload({ data: { access_token: 'unsigned-token' } }));
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(plainSessionId);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.tokenSets[0]!.accessToken).toBe('unsigned-token');
    });
  });

  describe('in-place upgrade on read (eager write-through)', () => {
    it('upgrades the legacy session in the store immediately on get(), before any explicit write', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        { secret, store: mockStore, legacyAudience: 'https://api.example.com' },
        handler
      );

      const legacyId = 'sess:eager-upgrade';
      await mockStore.set(legacyId, createFutureLegacyPayload());
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(legacyId);

      const result = await store.get('__a0_session', {});

      // The store now holds modern StateData under the same key — the caller never had to
      // call set() themselves for the upgrade (and its sid index, if any) to happen.
      expect(mockStore.keys()).toEqual([legacyId]);
      const stored = await mockStore.get(legacyId);
      expect(stored).toEqual(result);
      expect((stored as { header?: unknown }).header).toBeUndefined();
    });

    it('does not re-transform or re-write on a second get() once the session is modern', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        { secret, store: mockStore, legacyAudience: 'https://api.example.com' },
        handler
      );

      const legacyId = 'sess:eager-idempotent';
      await mockStore.set(legacyId, createFutureLegacyPayload());
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(legacyId);

      const first = await store.get('__a0_session', {});
      const setSpy = vi.spyOn(mockStore, 'set');
      const second = await store.get('__a0_session', {});

      expect(second).toEqual(first);
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('in-place upgrade on write', () => {
    const modernStateData = {
      user: { sub: 'auth0|123456' },
      idToken: undefined,
      refreshToken: 'refresh',
      tokenSets: [],
      internal: { sid: 'sid-xyz', createdAt: Math.floor(Date.now() / 1000) },
    };

    it('upgrades the legacy session in place on a removeIfExists=false write (no orphan)', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        { secret, store: mockStore, legacyAudience: 'https://api.example.com' },
        handler
      );

      const legacyId = 'sess:in-place';
      await mockStore.set(legacyId, createFutureLegacyPayload());
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(legacyId);

      await store.set('__a0_session', modernStateData, false, {});

      // Same key, now holding modern StateData — and no second (orphan) key was created.
      expect(mockStore.keys()).toEqual([legacyId]);
      expect(await mockStore.get(legacyId)).toEqual(modernStateData);
    });

    it('rotates to a fresh key and deletes the legacy session on a removeIfExists=true write (login)', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        { secret, store: mockStore, legacyAudience: 'https://api.example.com' },
        handler
      );

      const legacyId = 'sess:rotate';
      await mockStore.set(legacyId, createFutureLegacyPayload());
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(legacyId);

      await store.set('__a0_session', modernStateData, true, {});

      // Legacy key deleted; exactly one new (generated) key holds the modern data.
      expect(await mockStore.get(legacyId)).toBeUndefined();
      const remaining = mockStore.keys();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).not.toBe(legacyId);
      expect(await mockStore.get(remaining[0]!)).toEqual(modernStateData);
    });

    it('resolves a JWS-signed legacy cookie on write and upgrades in place', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        { secret, store: mockStore, legacySecret: secret, legacyAudience: 'https://api.example.com' },
        handler
      );

      const legacyId = 'sess:signed-write';
      const signedCookieValue = await createSignedCookie('__a0_session', legacyId, secret);
      await mockStore.set(legacyId, createFutureLegacyPayload());
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(signedCookieValue);

      await store.set('__a0_session', modernStateData, false, {});

      expect(mockStore.keys()).toEqual([legacyId]);
      expect(await mockStore.get(legacyId)).toEqual(modernStateData);
    });

    it('round-trips a modern session to the same key (legacy path does not interfere)', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        { secret, store: mockStore, legacyAudience: 'https://api.example.com' },
        handler
      );

      // No cookie yet → base generates a key and writes an encrypted { id } cookie.
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      await store.set('__a0_session', modernStateData, false, {});

      const generatedKey = mockStore.keys()[0]!;
      const setCookieMock = handler.setCookie as ReturnType<typeof vi.fn>;
      const encryptedCookie = setCookieMock.mock.calls.at(-1)![1] as string;

      // Feed the encrypted cookie back on read; the modern decrypt path must resolve it.
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(encryptedCookie);
      const result = await store.get('__a0_session', {});

      expect(mockStore.keys()).toEqual([generatedKey]);
      expect(result).toEqual(modernStateData);
    });

    it('does not route a modern-format (5-segment) cookie into legacy resolution', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        { secret, store: mockStore, legacyAudience: 'https://api.example.com' },
        handler
      );

      // A 5-segment value has the shape of a modern compact JWE. Even when it fails modern
      // decryption, it must NEVER be resolved as a legacy session ID (which would use the raw
      // string as a store key and orphan the real session).
      const modernShapedCookie = 'aaa.bbb.ccc.ddd.eee';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolved = await (store as any).decrypt('__a0_session', modernShapedCookie);
      expect(resolved).toBeUndefined();
    });

    it('never writes a modern-format cookie value as a store key on a removeIfExists=false write', async () => {
      const handler = createCookieHandler();
      const store = new MigrationStatefulStateStore(
        { secret, store: mockStore, legacyAudience: 'https://api.example.com' },
        handler
      );

      const modernShapedCookie = 'aaa.bbb.ccc.ddd.eee';
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(modernShapedCookie);

      await store.set('__a0_session', modernStateData, false, {});

      // The raw cookie ciphertext must not have leaked in as a store key.
      expect(mockStore.keys()).not.toContain(modernShapedCookie);
    });
  });
});
