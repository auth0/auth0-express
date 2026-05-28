import { describe, it, expect, vi } from 'vitest';
import { LegacyCompatibleStatelessStateStore } from './legacy-compatible-stateless-state-store.js';
import { ExpressCookieHandler } from './express-cookie-handler.js';
import { EncryptJWT } from 'jose';
import type { StateData } from '@auth0/auth0-server-js';

describe('LegacyCompatibleStatelessStateStore', () => {
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
      const store = new LegacyCompatibleStatelessStateStore(
        {
          secret,
          legacySecret: 'legacy-secret',
          legacyAudience: 'https://api.test.com',
          legacyScope: 'openid profile email',
        },
        cookieHandler
      );

      expect(store).toBeInstanceOf(LegacyCompatibleStatelessStateStore);
    });

    it('should use same secret for legacy if not provided', () => {
      const store = new LegacyCompatibleStatelessStateStore(
        {
          secret,
          legacyAudience: 'https://api.test.com',
        },
        cookieHandler
      );

      expect(store).toBeInstanceOf(LegacyCompatibleStatelessStateStore);
    });

    it('should use default audience and scope if not provided', () => {
      const store = new LegacyCompatibleStatelessStateStore(
        {
          secret,
        },
        cookieHandler
      );

      expect(store).toBeInstanceOf(LegacyCompatibleStatelessStateStore);
    });
  });

  describe('decrypt', () => {
    it('should decrypt modern auth0-server-js sessions normally', async () => {
      const store = new LegacyCompatibleStatelessStateStore(
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
      const store = new LegacyCompatibleStatelessStateStore(
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

    it('should transform legacy session format correctly', async () => {
      const store = new LegacyCompatibleStatelessStateStore(
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
      const store = new LegacyCompatibleStatelessStateStore(
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
      const store = new LegacyCompatibleStatelessStateStore(
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
      const store = new LegacyCompatibleStatelessStateStore(
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
      const store = new LegacyCompatibleStatelessStateStore(
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
      const store = new LegacyCompatibleStatelessStateStore(
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
      const store = new LegacyCompatibleStatelessStateStore(
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
      const store = new LegacyCompatibleStatelessStateStore(
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

    it('should decrypt with second secret when key rotation is used', async () => {
      const oldSecret = 'old-secret-that-is-at-least-32-chars-long!';
      const newSecret = 'new-secret-that-is-at-least-32-chars-long!';

      // Create store with only the new secret as main + old secret in rotation array
      const store = new LegacyCompatibleStatelessStateStore(
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

      const store = new LegacyCompatibleStatelessStateStore(
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
      const store = new LegacyCompatibleStatelessStateStore(
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

  return await new EncryptJWT(payload)
    .setProtectedHeader({ enc: 'A256GCM', alg: 'dir' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .encrypt(encryptionKey);
}
