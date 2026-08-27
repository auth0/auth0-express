import {
  StatefulStateStore,
  SessionConfiguration,
  type AbstractDataStore,
  type SessionStore,
} from '@auth0/auth0-server-js';
import type { CookieHandler, StateData } from '@auth0/auth0-server-js';
import { LegacySessionTransformer, warnSessionDropped } from './legacy-session-transformer.js';
import type { ExpressOpenidConnectStorePayload } from './legacy-session-transformer.js';
import { deriveHkdfKey } from './express-oidc-hkdf.js';

/**
 * Options for {@link MigrationStatefulStateStore}.
 */
export interface MigrationStatefulStateStoreOptions {
  /**
   * The secret used by auth0-server-js for encryption.
   *
   * Provide an array to support secret rotation: the first secret encrypts new cookies, while
   * all secrets are tried, in order, when decrypting.
   */
  secret: string | string[];

  /**
   * The secret(s) that were used by express-openid-connect for signing cookies.
   * Supports key rotation: provide an array to try multiple secrets in order.
   * If not provided, uses the same secret as auth0-server-js.
   */
  legacySecret?: string | string[];

  /**
   * Mirror of express-openid-connect's `requireSignedSessionStoreCookie`.
   *
   * When `true`, a legacy session-store cookie is only honored if it carries a valid
   * JWS signature (verified against one of {@link legacySecret}); an unsigned cookie
   * or one whose signature does not verify resolves to no session instead of being
   * used verbatim as the store key. Set this when migrating a deployment that ran
   * express-openid-connect with `requireSignedSessionStoreCookie: true`, so the
   * signature remains the required integrity control over the store key.
   *
   * Defaults to `false`, matching express-openid-connect's default.
   *
   * @default false
   */
  requireSignedLegacyCookie?: boolean;

  /**
   * The audience to assign to transformed token sets from express-openid-connect sessions.
   *
   * Token sets are looked up by audience, so this must equal the `audience` your app requests
   * (e.g. via `getAccessToken`) or the migrated access token will not be found. The default
   * `'default'` only matches callers that request no audience.
   *
   * Default: 'default'
   */
  legacyAudience?: string;

  /**
   * The scope to assign to transformed token sets from express-openid-connect sessions.
   * @default 'openid profile email offline_access'
   */
  legacyScope?: string;

  /**
   * The custom session store (Redis, MongoDB, etc.)
   */
  store: AbstractDataStore<unknown>;

  /**
   * Session configuration options
   */
  sessionConfiguration?: SessionConfiguration;
}

/**
 * A server-side (stateful) state store for zero-downtime migration from `express-openid-connect`
 * to `@auth0/auth0-express`.
 *
 * Extends {@link StatefulStateStore} and transparently reads existing
 * `express-openid-connect` sessions from Redis, MongoDB, or any other custom store,
 * converting them to the `auth0-server-js` format so users do not need to re-authenticate
 * during the migration.
 *
 * **How it works:** `express-openid-connect` wraps session data in a `{ header, data, cookie }`
 * envelope and stores a plain or JWS-signed session ID in the cookie. `auth0-server-js` stores
 * {@link StateData} directly and encrypts the session ID in the cookie. This store overrides
 * `decrypt` so the base machinery resolves the session ID from either cookie format, then reads
 * the store by that ID. On `get`, a legacy envelope is transformed into {@link StateData} and
 * immediately written back to the same store key via `set`, upgrading the session in place on
 * first read rather than waiting for the caller's next write. This is what makes backchannel
 * logout (`deleteByLogoutToken`) work for a migrated session right away: the app's store
 * typically needs to index sessions by `sid` to resolve a logout token, and that index is
 * naturally populated by `set`. A login (`removeIfExists=true`) still deletes the old key and
 * rotates to a fresh ID.
 *
 * @example
 * ```typescript
 * import { MigrationStatefulStateStore } from '@auth0/auth0-express/migration';
 *
 * const store = new MigrationStatefulStateStore(
 *   {
 *     secret: process.env.SESSION_SECRET,
 *     store: redisStore,
 *     legacySecret: process.env.SESSION_SECRET, // the secret used by express-openid-connect
 *     legacyAudience: 'https://api.example.com',
 *     legacyScope: 'openid profile email',
 *   },
 *   new ExpressCookieHandler()
 * );
 * ```
 */
export class MigrationStatefulStateStore<TStoreOptions> extends StatefulStateStore<TStoreOptions> {
  readonly #legacySecrets: string[];
  readonly #requireSignedLegacyCookie: boolean;
  readonly #transformer: LegacySessionTransformer;

  constructor(options: MigrationStatefulStateStoreOptions, cookieHandler: CookieHandler<TStoreOptions>) {
    super(
      {
        ...options.sessionConfiguration,
        secret: options.secret,
        store: options.store as unknown as SessionStore<TStoreOptions>,
      },
      cookieHandler
    );

    // Fall back to the app's session secret(s) when no explicit legacy secret is given. Either
    // may be an array (rotation), so normalize both to a flat string[] tried in order.
    const legacySecret = options.legacySecret ?? options.secret;
    this.#legacySecrets = Array.isArray(legacySecret) ? legacySecret : [legacySecret];

    this.#requireSignedLegacyCookie = options.requireSignedLegacyCookie ?? false;

    const legacyAudience = options.legacyAudience ?? 'default';
    const legacyScope = options.legacyScope ?? 'openid profile email offline_access';
    this.#transformer = new LegacySessionTransformer(legacyAudience, legacyScope);
  }

  /**
   * Overrides decrypt() so the base StatefulStateStore machinery can resolve a session ID
   * from BOTH modern and legacy express-openid-connect cookies.
   *
   * The base `getSessionId()` calls `this.decrypt(identifier, cookieValue)` and reads `.id`
   * from the result. A modern auth0-server-js cookie is a compact JWE (exactly 5 dot-separated
   * segments); a legacy cookie is a plain session ID (no dots) or a JWS-signed `<id>.<sig>`
   * (one dot). We route strictly by shape and never cross-resolve: feeding a modern JWE into the
   * legacy resolver would return the raw ciphertext as a "session ID" and orphan the real session
   * (e.g. when the base throws JWTExpired on an expired-but-valid modern cookie). Modern cookies
   * are delegated entirely to `super.decrypt` (preserving the base's expiry/error semantics);
   * legacy cookies are resolved to `{ id }` so read and write operate on the same store key —
   * upgrading the session in place on the first write.
   *
   * Note: routing is by dot-count. A legacy session ID that itself contains dots (only possible
   * with a custom express-openid-connect `genid`) whose signed form reaches exactly 5 segments
   * would be routed to the modern path and fail to resolve, forcing a one-time re-login. The
   * default `genid` (32 hex chars, no dots) is unaffected.
   */
  protected override async decrypt<TData>(
    identifier: string,
    encryptedStateData: string
  ): Promise<TData | undefined> {
    // Modern cookie: a compact JWE has exactly 5 dot-separated segments. Delegate to the base,
    // preserving its decryption and expiry semantics. Never fall back to legacy resolution here —
    // that would use the raw ciphertext as a store key.
    if (encryptedStateData.split('.').length === 5) {
      return super.decrypt<TData>(identifier, encryptedStateData);
    }

    // Legacy cookie: a plain session ID (no dots) or JWS-signed `<id>.<sig>` (one dot).
    const sessionId = await this.#resolveLegacySessionId(identifier, encryptedStateData);
    if (sessionId === undefined) return undefined;
    return { id: sessionId } as TData;
  }

  /**
   * Overrides get() to transform legacy express-openid-connect envelopes into StateData, and
   * eagerly upgrades the session in place by writing the transformed data back immediately.
   *
   * ID resolution (modern or legacy) is handled by the decrypt() override, so this only needs
   * to detect whether the value the base read from the store is a legacy `{ header, data, cookie }`
   * envelope and, if so, transform it. Modern StateData passes through unchanged.
   *
   * Without the eager write, a migrated session would only be upgraded on the caller's next
   * `set()` (e.g. token refresh, claim update) — until then, backchannel logout could not resolve
   * it, since the app's store commonly builds its `sid` index inside `set()`. Writing here trades
   * one extra store write on the session's first read after migration for backchannel logout
   * working immediately, rather than only after some unrelated future write. The write reuses the
   * same store key (`removeIfExists: false`) via the public `set()`, so it goes through the same
   * cookie/session-id resolution as any other write and is a no-op cost-wise for legacy sessions
   * that were about to be written anyway. A second `get()` within the same request re-reads the
   * now-modern payload and skips the transform/write, so this only happens once per session.
   */
  override async get(identifier: string, options?: TStoreOptions): Promise<StateData | undefined> {
    const data = await super.get(identifier, options);
    if (data && this.#isLegacyStorePayload(data)) {
      const stateData = this.#transformLegacyStorePayload(data);

      // When there is legacy state data found, we write-on-first-read to
      // convert the legacy session data, to the session data used by this SDK.
      if (stateData) {
        await this.set(identifier, stateData, false, options);
      }
      return stateData;
    }
    return data;
  }

  /**
   * Resolves a legacy session ID from a raw cookie value. If the value contains a dot,
   * it may be JWS-signed — try to verify and extract the unsigned portion.
   *
   * With {@link MigrationStatefulStateStoreOptions.requireSignedLegacyCookie} enabled, only a
   * valid JWS signature is accepted: an unsigned cookie or one whose signature does not verify
   * resolves to `undefined` (no session). Otherwise (the default, matching express-openid-connect
   * with `requireSignedSessionStoreCookie: false`) the raw value is used as the store key when it
   * is unsigned or its signature cannot be verified.
   */
  async #resolveLegacySessionId(cookieName: string, rawCookieValue: string): Promise<string | undefined> {
    if (rawCookieValue.includes('.')) {
      const stripped = await this.#resolveSignedCookie(cookieName, rawCookieValue);
      if (stripped !== undefined) return stripped;
    }

    // Signature required but the cookie was unsigned or failed verification: reject it rather than
    // trusting the raw value as the store key.
    if (this.#requireSignedLegacyCookie) return undefined;

    return rawCookieValue;
  }

  /**
   * Type guard to check if data is in express-openid-connect SessionStorePayload format
   */
  #isLegacyStorePayload(data: unknown): data is ExpressOpenidConnectStorePayload {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const payload = data as Record<string, unknown>;

    if (!('header' in payload) || !('data' in payload) || !('cookie' in payload)) {
      return false;
    }
    if (typeof payload.header !== 'object' || payload.header === null) {
      return false;
    }

    // The header timestamps are trusted downstream: `exp` gates expiry and `iat` becomes
    // `createdAt`. Require them to be numbers so a malformed envelope with a non-numeric `exp`
    // cannot slip past the `exp <= now` comparison (which would coerce and read as "not expired").
    const header = payload.header as Record<string, unknown>;
    return typeof header.iat === 'number' && typeof header.uat === 'number' && typeof header.exp === 'number';
  }

  /**
   * Transforms express-openid-connect SessionStorePayload to auth0-server-js StateData format.
   * Rejects expired sessions.
   */
  #transformLegacyStorePayload(payload: ExpressOpenidConnectStorePayload): StateData | undefined {
    // Reject once exp has been reached, mirroring appSession's `exp > epoch()` assertion
    // (i.e. invalid when `exp <= now`), not one second later.
    if (payload.header.exp <= Math.floor(Date.now() / 1000)) {
      return undefined;
    }
    const sessionData = this.#transformer.transformLegacySession(payload.data);
    sessionData.internal.createdAt = payload.header.iat;
    if (this.calculateMaxAge(payload.header.iat) <= 0) {
      warnSessionDropped(payload.header.iat);
    }
    return sessionData;
  }

  /**
   * Attempts to verify a JWS-signed cookie from express-openid-connect and return the
   * unsigned session ID. Tries each legacy secret in order.
   */
  async #resolveSignedCookie(cookieName: string, cookieValue: string): Promise<string | undefined> {
    for (const secret of this.#legacySecrets) {
      const result = await this.#verifySignedCookie(cookieName, cookieValue, secret);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }

  async #deriveLegacySigningKey(secret: string): Promise<CryptoKey> {
    const keyBytes = await deriveHkdfKey(secret, 'JWS Cookie Signing');
    return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  }

  async #verifySignedCookie(cookieName: string, cookieValue: string, secret: string): Promise<string | undefined> {
    try {
      const dotIndex = cookieValue.lastIndexOf('.');
      if (dotIndex === -1) return undefined;

      const sessionId = cookieValue.substring(0, dotIndex);
      const signatureB64 = cookieValue.substring(dotIndex + 1);

      // The fixed JWS header used by express-openid-connect
      const HEADER_B64 = 'eyJhbGciOiJIUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il19';

      const encoder = new TextEncoder();
      const rawPayload = encoder.encode(`${cookieName}=${sessionId}`);
      const headerBytes = encoder.encode(HEADER_B64 + '.');
      const signingInput = new Uint8Array(headerBytes.length + rawPayload.length);
      signingInput.set(headerBytes, 0);
      signingInput.set(rawPayload, headerBytes.length);

      const cryptoKey = await this.#deriveLegacySigningKey(secret);

      // Decode the base64url signature
      const sigBase64 = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
      const sigRaw = atob(sigBase64);
      const sigBytes = new Uint8Array(sigRaw.length);
      for (let i = 0; i < sigRaw.length; i++) sigBytes[i] = sigRaw.charCodeAt(i);

      const valid = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, signingInput);
      return valid ? sessionId : undefined;
    } catch {
      return undefined;
    }
  }
}
