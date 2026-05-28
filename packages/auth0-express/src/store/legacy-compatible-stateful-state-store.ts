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
 */
export class LegacyCompatibleStatefulStateStore<TStoreOptions> extends StatefulStateStore<TStoreOptions> {
  readonly #cookieHandler: CookieHandler<TStoreOptions>;
  readonly #store: AbstractDataStore<unknown>;
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

    this.#cookieHandler = cookieHandler;
    this.#store = options.store;

    this.#legacySecrets = Array.isArray(options.legacySecret)
      ? options.legacySecret
      : [options.legacySecret ?? options.secret];

    const legacyAudience = options.legacyAudience ?? 'default';
    const legacyScope = options.legacyScope ?? 'openid profile email offline_access';
    this.#transformer = new LegacySessionTransformer(legacyAudience, legacyScope);
  }

  /**
   * Overrides get() to handle legacy express-openid-connect sessions.
   *
   * Strategy: try the base class get() first (handles modern encrypted session IDs).
   * If that returns undefined, attempt to resolve the cookie as a legacy plain-text
   * or JWS-signed session ID, look it up in the store, and transform if needed.
   */
  override async get(
    identifier: string,
    options?: TStoreOptions
  ): Promise<StateData | undefined> {
    const modernResult = await super.get(identifier, options);
    if (modernResult) return modernResult;

    // Modern path returned nothing — attempt legacy session resolution.
    const rawCookieValue = this.#reassembleCookieChunks(identifier, options);
    if (!rawCookieValue) return undefined;

    const sessionId = await this.#resolveLegacySessionId(identifier, rawCookieValue);
    if (!sessionId) return undefined;

    const storeData = await this.#store.get(sessionId);
    if (!storeData) return undefined;

    if (this.#isLegacyStorePayload(storeData)) {
      return this.#transformLegacyStorePayload(storeData);
    }

    // Data is already in StateData format (shouldn't normally happen here, but be safe)
    return storeData as StateData;
  }

  /**
   * Legacy sessions don't use logout tokens. Intentional no-op.
   */
  override async deleteByLogoutToken(): Promise<void> {}

  /**
   * Resolves a legacy session ID from a raw cookie value. If the value contains a dot,
   * it may be JWS-signed — try to verify and extract the unsigned portion.
   * Falls back to the raw value if verification fails.
   */
  async #resolveLegacySessionId(cookieName: string, rawCookieValue: string): Promise<string> {
    if (rawCookieValue.includes('.')) {
      const stripped = await this.#resolveSignedCookie(cookieName, rawCookieValue);
      if (stripped !== undefined) return stripped;
    }
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
   * Rejects expired sessions.
   */
  #transformLegacyStorePayload(payload: ExpressOpenidConnectStorePayload): StateData | undefined {
    if (payload.header.exp < Math.floor(Date.now() / 1000)) {
      return undefined;
    }
    const sessionData = this.#transformer.transformLegacySession(payload.data);
    sessionData.internal.createdAt = payload.header.iat;
    return sessionData;
  }

  /**
   * Reads the base cookie and any numbered chunk cookies (`identifier.1`, `identifier.2`, …)
   * from the full cookie map, concatenating them in order.
   */
  #reassembleCookieChunks(identifier: string, options?: TStoreOptions): string | undefined {
    const first = this.#cookieHandler.getCookie(identifier, options);
    if (!first) return undefined;

    const allCookies = this.#cookieHandler.getCookies(options);
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

    return crypto.subtle.importKey('raw', derivedBits, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
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
      const sigBytes = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));

      const valid = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, signingInput);
      return valid ? sessionId : undefined;
    } catch {
      return undefined;
    }
  }
}
