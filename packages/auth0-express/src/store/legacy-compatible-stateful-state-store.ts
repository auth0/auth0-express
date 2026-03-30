import {
  StatefulStateStore,
  SessionConfiguration,
  type AbstractDataStore,
  type SessionStore,
} from '@auth0/auth0-server-js';
import type { CookieHandler, StateData } from '@auth0/auth0-server-js';
import { LegacySessionTransformer } from './legacy-session-transformer.js';
import type { ExpressOpenidConnectSession, ExpressOpenidConnectStorePayload } from './legacy-session-transformer.js';

/**
 * Options for creating a legacy-compatible stateful state store
 */
export interface LegacyCompatibleStatefulStoreOptions {
  /**
   * The secret used by auth0-server-js for encryption
   */
  secret: string;

  /**
   * The secret(s) that were used by express-openid-connect for signing cookies.
   * Supports key rotation: provide an array to try multiple secrets in order.
   * If not provided, uses the same secret as auth0-server-js.
   */
  legacySecret?: string | string[];

  /**
   * The audience to assign to transformed token sets from express-openid-connect sessions.
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
 * A stateful state store that provides backward compatibility with express-openid-connect sessions.
 *
 * This store extends StatefulStateStore from auth0-server-js and overrides the get method
 * to detect and transform express-openid-connect session data stored in external stores
 * (Redis, MongoDB, etc.) to the auth0-server-js format. This allows seamless migration from
 * express-openid-connect without forcing users to re-authenticate.
 *
 * Key differences in session storage format:
 * - express-openid-connect wraps session data in a SessionStorePayload with header/data/cookie
 * - auth0-server-js stores StateData directly
 * - express-openid-connect stores flat structure with id_token, access_token, etc.
 * - auth0-server-js uses structured format with user, idToken, tokenSets, etc.
 *
 * @example
 * ```typescript
 * import { LegacyCompatibleStatefulStateStore } from '@auth0/auth0-express';
 * import { ExpressCookieHandler } from './express-cookie-handler';
 * import RedisStore from 'connect-redis';
 * import { createClient } from 'redis';
 *
 * const redisClient = createClient();
 * await redisClient.connect();
 *
 * const store = new LegacyCompatibleStatefulStateStore(
 *   {
 *     secret: process.env.SESSION_SECRET,
 *     store: new RedisStore({ client: redisClient }),
 *     legacyAudience: 'https://api.example.com',
 *     legacyScope: 'openid profile email',
 *   },
 *   new ExpressCookieHandler()
 * );
 * ```
 */
export class LegacyCompatibleStatefulStateStore<TStoreOptions> extends StatefulStateStore<TStoreOptions> {
  protected readonly _cookieHandler: CookieHandler<TStoreOptions>;
  protected readonly _store: AbstractDataStore<unknown>;
  readonly #legacySecrets: string[];
  readonly #transformer: LegacySessionTransformer;

  constructor(options: LegacyCompatibleStatefulStoreOptions, cookieHandler: CookieHandler<TStoreOptions>) {
    super(
      {
        ...options.sessionConfiguration,
        secret: options.secret,
        store: options.store as unknown as SessionStore<TStoreOptions>,
      },
      cookieHandler
    );

    this._cookieHandler = cookieHandler;
    this._store = options.store;

    this.#legacySecrets = Array.isArray(options.legacySecret)
      ? options.legacySecret
      : [options.legacySecret ?? options.secret];

    const legacyAudience = options.legacyAudience ?? 'default';
    const legacyScope = options.legacyScope ?? 'openid profile email offline_access';
    this.#transformer = new LegacySessionTransformer(legacyAudience, legacyScope);
  }

  /**
   * Overrides getSessionId so that both get() and set() can resolve a legacy
   * express-openid-connect session ID from the cookie. The base class calls
   * this.decrypt() on the raw cookie value, which fails for the plain-text
   * (possibly JWS-signed) IDs that express-openid-connect stored. We catch
   * that failure and fall back to the raw value, stripping any JWS signature.
   *
   * Overriding here (rather than in get() alone) also fixes set(): the base
   * class set() calls getSessionId() to find the existing session before
   * writing the new one, so without this override token refresh and other
   * write operations would throw for legacy sessions.
   */
  override async getSessionId(identifier: string, options?: TStoreOptions): Promise<string | undefined> {
    try {
      return await super.getSessionId(identifier, options);
    } catch {
      // Modern decryption failed — the cookie is a legacy plain-text session ID.
      const rawCookieValue = this.#reassembleCookieChunks(identifier, options);
      if (!rawCookieValue) return undefined;

      if (rawCookieValue.includes('.')) {
        const stripped = await this.#resolveSignedCookie(identifier, rawCookieValue);
        if (stripped !== undefined) return stripped;
      }

      return rawCookieValue;
    }
  }

  /**
   * Overrides get() to transform express-openid-connect session data to
   * auth0-server-js StateData format. getSessionId() already handles legacy
   * cookie decoding, so super.get() resolves correctly for both modern and
   * legacy sessions; we only need to transform the store payload if needed.
   */
  override async get(
    identifier: string,
    options?: TStoreOptions
  ): Promise<StateData | undefined> {
    const data = await super.get(identifier, options);
    if (!data) return undefined;
    return this.isLegacyStorePayload(data) ? this.transformLegacyStorePayload(data) : data;
  }

  /**
   * Legacy sessions don't use logout tokens. Intentional no-op.
   */
  override async deleteByLogoutToken(): Promise<void> {
    // Legacy sessions don't use logout tokens. Intentional no-op.
  }

  /**
   * Type guard to check if data is in express-openid-connect SessionStorePayload format
   * @protected
   */
  protected isLegacyStorePayload(data: unknown): data is ExpressOpenidConnectStorePayload {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const payload = data as Record<string, unknown>;

    // Check for the express-openid-connect structure
    return (
      'header' in payload &&
      'data' in payload &&
      'cookie' in payload &&
      typeof payload.header === 'object' &&
      payload.header !== null &&
      'iat' in payload.header &&
      'uat' in payload.header &&
      'exp' in payload.header
    );
  }

  /**
   * Transforms express-openid-connect SessionStorePayload to auth0-server-js StateData format.
   * Uses header.iat as createdAt for accurate session creation time.
   * @protected
   */
  protected transformLegacyStorePayload(payload: ExpressOpenidConnectStorePayload): StateData {
    const sessionData = this.transformLegacySession(payload.data);
    sessionData.internal.createdAt = payload.header.iat;
    return sessionData;
  }

  /**
   * Transforms express-openid-connect session format to auth0-server-js StateData format
   * @protected
   */
  protected transformLegacySession(legacy: ExpressOpenidConnectSession): StateData {
    return this.#transformer.transformLegacySession(legacy);
  }

  /**
   * Reads the base cookie and any numbered chunk cookies (`identifier.1`, `identifier.2`, …)
   * from the full cookie map, concatenating them in order. This matches the chunking scheme used
   * by express-openid-connect when a session ID exceeds the 4096-byte cookie limit.
   *
   * Returns undefined if the base cookie is absent.
   */
  #reassembleCookieChunks(identifier: string, options?: TStoreOptions): string | undefined {
    const first = this._cookieHandler.getCookie(identifier, options);
    if (!first) return undefined;

    // Scan all cookies for additional chunks (identifier.1, identifier.2, …)
    const allCookies = this._cookieHandler.getCookies(options);
    const prefix = `${identifier}.`;
    const extraChunks = Object.entries(allCookies)
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, value]) => ({ index: parseInt(name.slice(prefix.length), 10), value }))
      .filter(({ index }) => Number.isInteger(index) && index > 0)
      .sort((a, b) => a.index - b.index)
      .map(({ value }) => value);

    return extraChunks.length > 0 ? [first, ...extraChunks].join('') : first;
  }

  /**
   * Attempts to verify a JWS-signed cookie from express-openid-connect and return the
   * unsigned session ID. Tries each legacy secret in order.
   *
   * express-openid-connect signs cookies using JWS with:
   * - HKDF key: info "JWS Cookie Signing", SHA-256, empty salt, 32 bytes
   * - Protected header: {"alg":"HS256","b64":false,"crit":["b64"]} (fixed base64url)
   * - Signing input: base64url(header) + "." + raw bytes of "${cookieName}=${sessionId}"
   * - Signature: HMAC-SHA256, base64url-encoded
   *
   * Returns the unsigned session ID if verification succeeds, or undefined if all secrets fail.
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

  /**
   * Derives the HKDF signing key used by express-openid-connect for cookie signing.
   */
  async #deriveLegacySigningKey(secret: string): Promise<Uint8Array> {
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

    return new Uint8Array(derivedBits);
  }

  /**
   * Verifies a JWS-signed cookie value and returns the session ID portion if valid.
   * Returns undefined if verification fails.
   */
  async #verifySignedCookie(cookieName: string, cookieValue: string, secret: string): Promise<string | undefined> {
    try {
      // express-openid-connect JWS format: header.signature
      // where the payload is unencoded (b64:false) and is "${cookieName}=${sessionId}"
      const dotIndex = cookieValue.lastIndexOf('.');
      if (dotIndex === -1) return undefined;

      const sessionId = cookieValue.substring(0, dotIndex);
      const signatureB64 = cookieValue.substring(dotIndex + 1);

      // The fixed JWS header used by express-openid-connect
      const HEADER_B64 = 'eyJhbGciOiJIUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il19';

      // Signing input: base64url(header) + "." + raw payload bytes
      const encoder = new TextEncoder();
      const rawPayload = encoder.encode(`${cookieName}=${sessionId}`);
      const headerBytes = encoder.encode(HEADER_B64 + '.');
      const signingInput = new Uint8Array(headerBytes.length + rawPayload.length);
      signingInput.set(headerBytes, 0);
      signingInput.set(rawPayload, headerBytes.length);

      const keyBytes = await this.#deriveLegacySigningKey(secret);
      const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
        'verify',
      ]);

      // Decode the base64url signature
      const sigBase64 = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
      const sigBytes = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));

      const valid = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, signingInput);
      return valid ? sessionId : undefined;
    } catch {
      return undefined;
    }
  }
}
