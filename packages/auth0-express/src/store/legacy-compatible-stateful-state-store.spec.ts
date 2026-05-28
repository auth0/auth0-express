import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LegacyCompatibleStatefulStateStore } from './legacy-compatible-stateful-state-store.js';
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

  describe('get - legacy session with plain text session ID', () => {
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
      const store = new LegacyCompatibleStatefulStateStore(
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
  });

  describe('get - uses header.iat for createdAt', () => {
    it('should use header.iat for createdAt when transforming legacy store payload', async () => {
      const handler = createCookieHandler();
      const store = new LegacyCompatibleStatefulStateStore(
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

      const legacySessionData = createFutureLegacyPayload({
        data: { access_token: 'signed-access-token', refresh_token: 'signed-refresh-token' },
      });

      await mockStore.set(plainSessionId, legacySessionData);
      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(signedCookieValue);

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.tokenSets[0]!.accessToken).toBe('signed-access-token');
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
      const store = new LegacyCompatibleStatefulStateStore(
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

      const chunk1 = 'sess:chunked';
      const chunk2 = 'abc123';
      const fullSessionId = chunk1 + chunk2;

      const legacySessionData = createFutureLegacyPayload({
        data: { access_token: 'chunked-access-token' },
      });

      await mockStore.set(fullSessionId, legacySessionData);

      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(chunk1);
      (handler.getCookies as ReturnType<typeof vi.fn>).mockReturnValue({
        '__a0_session': chunk1,
        '__a0_session.1': chunk2,
      });

      const result = await store.get('__a0_session', {});

      expect(result).toBeDefined();
      expect(result!.tokenSets[0]!.accessToken).toBe('chunked-access-token');
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

      (handler.getCookie as ReturnType<typeof vi.fn>).mockReturnValue(signedCookieValue);

      const result = await store.get('__a0_session', {});

      expect(result).toBeUndefined();
    });
  });
});
