import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LegacyCompatibleStatefulStateStore } from './legacy-compatible-stateful-state-store.js';
import type { CookieHandler, AbstractDataStore } from '@auth0/auth0-server-js';

/**
 * Creates a JWS-signed cookie value matching the express-openid-connect format.
 * - HKDF key: info "JWS Cookie Signing", SHA-256, empty salt, 32 bytes
 * - Protected header: {"alg":"HS256","b64":false,"crit":["b64"]} (fixed base64url)
 * - Signing input: base64url(header) + "." + raw "${cookieName}=${sessionId}"
 * - Returns: "${sessionId}.${signature_base64url}"
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
    } as HkdfParams,
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

// Mock external store (like Redis)
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
}

// Sample ID token for testing
const sampleIdToken =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdXRoMHwxMjM0NTYiLCJuYW1lIjoiSm9obiBEb2UiLCJlbWFpbCI6ImpvaG5AZXhhbXBsZS5jb20iLCJpYXQiOjE1MTYyMzkwMjJ9.dummy';

describe('LegacyCompatibleStatefulStateStore', () => {
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
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.test.com',
          legacyScope: 'openid profile email',
        },
        handler
      );

      expect(store).toBeInstanceOf(LegacyCompatibleStatefulStateStore);
    });

    it('should use default audience and scope if not provided', () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      expect(store).toBeInstanceOf(LegacyCompatibleStatefulStateStore);
    });
  });

  describe('integration - legacy session with plain text session ID', () => {
    it('should handle plain text session ID cookie from express-openid-connect', async () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.example.com',
          legacyScope: 'openid profile email',
        },
        handler
      );

      // Simulate express-openid-connect legacy session
      // 1. Plain text session ID in cookie (not encrypted)
      const plainSessionId = 'sess:abc123def456';

      // 2. Legacy session data in Redis/MongoDB
      const legacySessionData = {
        header: {
          iat: 1234567890,
          uat: 1234567890,
          exp: 1234567890 + 3600,
        },
        data: {
          id_token: sampleIdToken,
          access_token: 'legacy-access-token',
          refresh_token: 'legacy-refresh-token',
          expires_at: 1234567890,
        },
        cookie: {
          expires: 1234567890 + 3600,
          maxAge: 3600,
        },
      };

      // Store the legacy session in the mock store
      await mockStore.set(plainSessionId, legacySessionData);

      // Mock cookie handler to return the plain text session ID
      (handler.getCookie as any).mockReturnValue(plainSessionId);

      const options = { req: {}, res: {} };

      // Get should:
      // 1. Try to decrypt the session ID (will fail because it's plain text)
      // 2. Fall back to using it as-is (plain text)
      // 3. Fetch the session data from the store
      // 4. Detect it's in legacy format and transform it
      const result = await store.get('__a0_session', options);

      expect(result).toBeDefined();
      expect(result?.user).toBeDefined();
      expect(result?.user?.sub).toBe('auth0|123456');
      expect(result?.idToken).toBe(sampleIdToken);
      expect(result?.refreshToken).toBe('legacy-refresh-token');
      expect(result?.tokenSets).toHaveLength(1);
      expect(result?.tokenSets?.[0].accessToken).toBe('legacy-access-token');
      expect(result?.tokenSets?.[0].audience).toBe('https://api.example.com');
      expect(result?.tokenSets?.[0].scope).toBe('openid profile email');
    });

    it('should not transform modern session data already in auth0-server-js format', () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      // Modern auth0-server-js session data (not wrapped in SessionStorePayload)
      const modernSessionData = {
        user: { sub: 'auth0|123456', name: 'John Doe' },
        idToken: sampleIdToken,
        refreshToken: 'modern-refresh-token',
        tokenSets: [
          {
            audience: 'https://api.example.com',
            scope: 'openid profile email',
            accessToken: 'modern-access-token',
            expiresAt: 1234567890,
          },
        ],
        internal: {
          sid: 'test-sid',
          createdAt: 1234567890,
        },
      };

      // Verify it's not detected as legacy format
      const isLegacy = (store as any).isLegacyStorePayload(modernSessionData);
      expect(isLegacy).toBe(false);

      // This verifies that modern sessions pass through the get() method without transformation
      // The actual encrypted session ID handling is tested by the parent StatefulStateStore class
    });
  });

  describe('legacy transformation logic', () => {
    it('should detect express-openid-connect SessionStorePayload format', () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      // Access the protected method for testing
      const isLegacy = (store as any).isLegacyStorePayload.bind(store);

      const legacyPayload = {
        header: { iat: 123, uat: 123, exp: 456 },
        data: { id_token: 'token' },
        cookie: { expires: 456, maxAge: 333 },
      };

      const modernData = {
        user: { sub: '123' },
        idToken: 'token',
        tokenSets: [],
        internal: { sid: '', createdAt: 123 },
      };

      expect(isLegacy(legacyPayload)).toBe(true);
      expect(isLegacy(modernData)).toBe(false);
      expect(isLegacy(null)).toBe(false);
      expect(isLegacy('string')).toBe(false);
    });

    it('should transform legacy session to modern format', () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.example.com',
          legacyScope: 'openid profile email read:data',
        },
        handler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_at: 1234567890,
        customField: 'custom-value',
      };

      const result = (store as any).transformLegacySession(legacySession);

      expect(result.user).toBeDefined();
      expect(result.user.sub).toBe('auth0|123456');
      expect(result.user.name).toBe('John Doe');
      expect(result.idToken).toBe(sampleIdToken);
      expect(result.refreshToken).toBe('test-refresh-token');
      expect(result.tokenSets).toHaveLength(1);
      expect(result.tokenSets[0].accessToken).toBe('test-access-token');
      expect(result.tokenSets[0].audience).toBe('https://api.example.com');
      expect(result.tokenSets[0].scope).toBe('openid profile email read:data');
      expect(result.tokenSets[0].expiresAt).toBe(1234567890);
      expect(result.customField).toBe('custom-value');
    });

    it('should handle legacy sessions without access tokens', () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      const legacySession = {
        id_token: sampleIdToken,
        // No access_token
      };

      const result = (store as any).transformLegacySession(legacySession);

      expect(result.tokenSets).toEqual([]);
      expect(result.idToken).toBe(sampleIdToken);
    });

    it('should handle expires_at as string', () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        expires_at: '1234567890', // String instead of number
      };

      const result = (store as any).transformLegacySession(legacySession);

      expect(result.tokenSets[0].expiresAt).toBe(1234567890);
    });

    it('should use default scope when not specified', () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.example.com',
          // No legacyScope specified
        },
        handler
      );

      const legacySession = {
        id_token: sampleIdToken,
        access_token: 'test-access-token',
        expires_at: 1234567890,
      };

      const result = (store as any).transformLegacySession(legacySession);

      expect(result.tokenSets[0].scope).toBe('openid profile email offline_access');
    });

    it('should use header.iat for createdAt when transforming legacy store payload', () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      const legacyPayload = {
        header: { iat: 1700000000, uat: 1700000001, exp: 1700003600 },
        data: {
          id_token: sampleIdToken,
          access_token: 'test-access-token',
          expires_at: 1700003600,
        },
        cookie: { expires: 1700003600, maxAge: 3600 },
      };

      const result = (store as any).transformLegacyStorePayload(legacyPayload);

      expect(result.internal.createdAt).toBe(1700000000);
    });
  });

  describe('deleteByLogoutToken', () => {
    it('should resolve without throwing (no-op)', async () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
        },
        handler
      );

      await expect(store.deleteByLogoutToken()).resolves.toBeUndefined();
    });
  });

  describe('signed cookie handling', () => {
    it('should use unsigned session ID after verifying JWS-signed cookie', async () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
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

      const legacySessionData = {
        header: { iat: 1234567890, uat: 1234567890, exp: 1234567890 + 3600 },
        data: {
          id_token: sampleIdToken,
          access_token: 'signed-access-token',
          refresh_token: 'signed-refresh-token',
          expires_at: 1234567890,
        },
        cookie: { expires: 1234567890 + 3600, maxAge: 3600 },
      };

      // Store session under the UNSIGNED session ID
      await mockStore.set(plainSessionId, legacySessionData);

      (handler.getCookie as any).mockReturnValue(signedCookieValue);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result?.tokenSets?.[0].accessToken).toBe('signed-access-token');
    });

    it('should fall back to raw cookie value when signature is invalid', async () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: secret,
        },
        handler
      );

      const plainSessionId = 'sess:invalidsig';
      // Malformed signed cookie: session.invalidsignature
      const invalidSignedValue = `${plainSessionId}.invalidsignatureXXX`;

      // Store session under the plain ID (simulates raw fallback)
      const legacySessionData = {
        header: { iat: 1234567890, uat: 1234567890, exp: 1234567890 + 3600 },
        data: { id_token: sampleIdToken, access_token: 'fallback-token', expires_at: 1234567890 },
        cookie: { expires: 1234567890 + 3600, maxAge: 3600 },
      };
      await mockStore.set(invalidSignedValue, legacySessionData);

      (handler.getCookie as any).mockReturnValue(invalidSignedValue);

      const result = await store.get('__a0_session', {});

      // Falls back to using the raw cookie value as the store key
      expect(result).toBeDefined();
      expect(result?.tokenSets?.[0].accessToken).toBe('fallback-token');
    });

    it('should handle unsigned cookie (no dot) as before', async () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      const plainSessionId = 'sess:nodot123';

      const legacySessionData = {
        header: { iat: 1234567890, uat: 1234567890, exp: 1234567890 + 3600 },
        data: {
          id_token: sampleIdToken,
          access_token: 'unsigned-access-token',
          expires_at: 1234567890,
        },
        cookie: { expires: 1234567890 + 3600, maxAge: 3600 },
      };

      await mockStore.set(plainSessionId, legacySessionData);
      (handler.getCookie as any).mockReturnValue(plainSessionId);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result?.tokenSets?.[0].accessToken).toBe('unsigned-access-token');
    });

    it('should reassemble chunked cookie values before using as store key', async () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacyAudience: 'https://api.example.com',
        },
        handler
      );

      // Simulate a session ID split across two cookies
      const chunk1 = 'sess:chunked';
      const chunk2 = 'abc123';
      const fullSessionId = chunk1 + chunk2;

      const legacySessionData = {
        header: { iat: 1234567890, uat: 1234567890, exp: 1234567890 + 3600 },
        data: {
          id_token: sampleIdToken,
          access_token: 'chunked-access-token',
          expires_at: 1234567890,
        },
        cookie: { expires: 1234567890 + 3600, maxAge: 3600 },
      };

      // Store session under the FULL (reassembled) session ID
      await mockStore.set(fullSessionId, legacySessionData);

      // Base cookie from getCookie; extra chunks from getCookies
      (handler.getCookie as any).mockReturnValue(chunk1);
      (handler.getCookies as any).mockReturnValue({
        '__a0_session': chunk1,
        '__a0_session.1': chunk2,
      });

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result?.tokenSets?.[0].accessToken).toBe('chunked-access-token');
    });

    it('should return undefined when signed cookie cannot be resolved and store has no matching entry', async () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
        {
          secret,
          store: mockStore,
          legacySecret: 'wrong-secret-that-is-long-enough-to-pass',
        },
        handler
      );

      const signedCookieValue = await createSignedCookie('__a0_session', 'sess:missing', secret);

      (handler.getCookie as any).mockReturnValue(signedCookieValue);

      const result = await store.get('__a0_session', {});

      // Signature verification fails (wrong secret), falls back to raw value, store lookup returns nothing
      expect(result).toBeUndefined();
    });
  });
});
