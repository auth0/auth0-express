import type { UserClaims, StateData } from '@auth0/auth0-server-js';

/**
 * Legacy session format from express-openid-connect
 */
export interface ExpressOpenidConnectSession {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number | string;
  [key: string]: unknown;
}

/**
 * Session store payload structure from express-openid-connect
 */
export interface ExpressOpenidConnectStorePayload {
  header: {
    iat: number;
    uat: number;
    exp: number;
  };
  data: ExpressOpenidConnectSession;
  cookie: {
    expires: number;
    maxAge: number;
  };
}

/**
 * Shared utility for transforming legacy express-openid-connect sessions to auth0-server-js StateData format.
 */
export class LegacySessionTransformer {
  readonly #legacyAudience: string;
  readonly #legacyScope: string;

  constructor(audience: string, scope: string) {
    this.#legacyAudience = audience;
    this.#legacyScope = scope;
  }

  /**
   * Transforms express-openid-connect session format to auth0-server-js StateData format
   */
  transformLegacySession(legacy: ExpressOpenidConnectSession): StateData {
    // Parse user claims from ID token
    const user = legacy.id_token ? this.decodeJWT(legacy.id_token) : undefined;

    // Convert expires_at to number if it's a string. A non-numeric string parses to NaN;
    // fall back to 0 so a malformed value is treated as already-expired, not persisted as NaN.
    const parsedExpiresAt =
      typeof legacy.expires_at === 'string' ? parseInt(legacy.expires_at, 10) : legacy.expires_at ?? 0;
    const expiresAt = Number.isNaN(parsedExpiresAt) ? 0 : parsedExpiresAt;

    // Build the transformed session data
    const transformed: StateData = {
      user,
      idToken: legacy.id_token,
      refreshToken: legacy.refresh_token,
      tokenSets: legacy.access_token
        ? [
            {
              audience: this.#legacyAudience,
              scope: this.#legacyScope,
              accessToken: legacy.access_token,
              expiresAt,
            },
          ]
        : [],
      internal: {
        sid: (legacy.sid as string | undefined) ?? (user?.sid as string | undefined) ?? '',
        createdAt: Math.floor(Date.now() / 1000),
      },
    };

    // Preserve any additional custom properties, excluding the transformed ones
    const excludedKeys = new Set([
      'id_token',
      'access_token',
      'refresh_token',
      'token_type',
      'expires_at',
      'sid',
      'user',
      'idToken',
      'refreshToken',
      'tokenSets',
      'internal',
    ]);

    for (const [key, value] of Object.entries(legacy)) {
      if (!excludedKeys.has(key)) {
        transformed[key] = value;
      }
    }

    return transformed;
  }

  /**
   * Decodes a JWT token without verification to extract claims.
   * This is safe for transformations since the token was already encrypted
   * in the session and will be re-encrypted.
   */
  decodeJWT(token: string): UserClaims | undefined {
    try {
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[1]) {
        return undefined;
      }
      const payload = parts[1];
      // Handle URL-safe base64
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8');
      return JSON.parse(jsonPayload) as UserClaims;
    } catch {
      return undefined;
    }
  }
}

/**
 * Emits a one-line warning that a freshly transformed migrated session will be dropped on its
 * first write. Call this once the store has determined the session exceeds its expiry window
 * (i.e. `calculateMaxAge(createdAt) <= 0`) — the exact condition under which the write-back emits
 * a cookie the browser discards, a silent logout of a session that was still valid under
 * express-openid-connect. Surfacing it in logs turns an invisible misconfiguration (someone
 * followed the migration guide but did not raise `absoluteDuration`) into an immediate, actionable
 * signal.
 *
 * @param createdAt The migrated session's original creation time (the eoc `iat`), in seconds.
 */
export function warnSessionDropped(createdAt: number): void {
  const ageDays = Math.floor((Math.floor(Date.now() / 1000) - createdAt) / (60 * 60 * 24));
  console.warn(
    `[auth0-express] Migrated session is ${ageDays}d old and already exceeds the configured ` +
      `sessionConfiguration.absoluteDuration, so it will be logged out on its first write. Set ` +
      `sessionConfiguration.absoluteDuration to at least your express-openid-connect deployment's ` +
      `value (default 7 days / 604800) to keep in-flight sessions alive across the migration.`
  );
}
