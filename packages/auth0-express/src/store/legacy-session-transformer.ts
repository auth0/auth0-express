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
        // Prefer the session-level sid, fall back to the ID token's sid claim, and finally to ''
        // when neither is present. A session with an empty sid cannot be targeted by backchannel
        // logout (which resolves sessions by sid), so stores that index by sid should skip indexing
        // an empty value rather than collapsing every sid-less session onto one shared key.
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
 * Emits a one-time startup warning when a migration store is constructed without an explicit
 * `sessionConfiguration.absoluteDuration`. A migrated session keeps its original
 * express-openid-connect creation time, and this SDK expires a session at
 * `createdAt + absoluteDuration`. This SDK defaults `absoluteDuration` to 3 days while
 * express-openid-connect defaults it to 7 — so relying on the default *can* cut short a
 * carried-over session already older than 3 days. Warning once at construction (rather than per
 * read) surfaces the potential misconfiguration before any user is affected, without log spam or
 * per-session bookkeeping.
 *
 * This is a heuristic for the most common mistake ("forgot to raise it"), not a precise check: it
 * only knows whether the value was *set*, not whether it is large enough for the sessions being
 * migrated. It cannot see the old deployment's `absoluteDuration`, so it may warn when the old
 * value was actually lower (the default is then fine), and it stays silent when an explicit value
 * is still too low. It only fires when the value is left unset — an app that chose a value made a
 * deliberate decision and is not warned.
 *
 * @param sessionConfiguration The store's session configuration, if any.
 */
export function warnIfAbsoluteDurationUnset(sessionConfiguration?: { absoluteDuration?: number }): void {
  if (sessionConfiguration?.absoluteDuration !== undefined) {
    return;
  }

  console.warn(
    `[auth0-express] Migration store created without sessionConfiguration.absoluteDuration. This ` +
      `SDK defaults it to 3 days, but express-openid-connect defaults to 7 — so if your previous ` +
      `deployment used a longer absoluteDuration, migrated sessions already older than 3 days may ` +
      `be logged out on their first write. Set sessionConfiguration.absoluteDuration to at least ` +
      `your express-openid-connect deployment's value (default 7 days / 604800) to keep in-flight ` +
      `sessions alive across the migration.`
  );
}
