import { StatelessStateStore, SessionConfiguration } from '@auth0/auth0-server-js';
import type { CookieHandler } from '@auth0/auth0-server-js';
import { jwtDecrypt, errors } from 'jose';
import type { JWEHeaderParameters } from 'jose';
import { LegacySessionTransformer } from './legacy-session-transformer.js';
import type { ExpressOpenidConnectSession } from './legacy-session-transformer.js';
import { deriveHkdfKey } from './express-oidc-hkdf.js';

/**
 * Options for {@link MigrationStatelessStateStore}.
 */
export interface MigrationStatelessStateStoreOptions {
  /**
   * The secret used by auth0-server-js for encryption
   */
  secret: string;

  /**
   * The secret(s) that were used by express-openid-connect for encryption.
   * Supports key rotation: provide an array to try multiple secrets in order.
   * If not provided, falls back to using the same secret as auth0-server-js.
   */
  legacySecret?: string | string[];

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
   * Session configuration options
   */
  sessionConfiguration?: SessionConfiguration;
}

/**
 * A cookie-based (stateless) state store for zero-downtime migration from `express-openid-connect`
 * to `@auth0/auth0-express`.
 *
 * Extends {@link StatelessStateStore} and transparently decrypts existing
 * `express-openid-connect` session cookies on first access, converting them to the
 * `auth0-server-js` format so users do not need to re-authenticate during the migration.
 *
 * **How it works:** `express-openid-connect` encrypts session cookies with `A256GCM` (HKDF
 * derived, info `"JWE CEK"`). `auth0-server-js` uses `A256CBC-HS512` with a different
 * derivation. This store tries the modern decryption first; if that fails it falls back to
 * the `express-openid-connect` decryption and transforms the result into {@link StateData}.
 *
 * Once the user's next request writes back the session, the cookie is re-encrypted in the
 * modern format and this fallback path is no longer exercised for that user.
 *
 * @example
 * ```typescript
 * import { MigrationStatelessStateStore } from '@auth0/auth0-express/migration';
 *
 * const store = new MigrationStatelessStateStore(
 *   {
 *     secret: process.env.SESSION_SECRET,
 *     legacySecret: process.env.SESSION_SECRET, // the secret used by express-openid-connect
 *     legacyAudience: 'https://api.example.com',
 *     legacyScope: 'openid profile email',
 *   },
 *   new ExpressCookieHandler()
 * );
 * ```
 */
export class MigrationStatelessStateStore<TStoreOptions> extends StatelessStateStore<TStoreOptions> {
  readonly #legacySecrets: string[];
  readonly #transformer: LegacySessionTransformer;

  constructor(options: MigrationStatelessStateStoreOptions, cookieHandler: CookieHandler<TStoreOptions>) {
    super(
      {
        ...options.sessionConfiguration,
        secret: options.secret,
      },
      cookieHandler
    );

    this.#legacySecrets = Array.isArray(options.legacySecret)
      ? options.legacySecret
      : [options.legacySecret ?? options.secret];

    const legacyAudience = options.legacyAudience ?? 'default';
    const legacyScope = options.legacyScope ?? 'openid profile email offline_access';
    this.#transformer = new LegacySessionTransformer(legacyAudience, legacyScope);
  }

  /**
   * Overrides the decrypt method to try modern decryption first, then fall back to legacy decryption.
   *
   * The base class decrypt throws on decryption failure. We catch that and attempt legacy
   * express-openid-connect decryption. If both fail, we return undefined.
   */
  protected override async decrypt<TData>(
    identifier: string,
    encryptedStateData: string
  ): Promise<TData | undefined> {
    try {
      const modernResult = await super.decrypt<TData>(identifier, encryptedStateData);
      if (modernResult !== undefined) return modernResult;
    } catch {
      // Modern decryption threw — fall through to legacy attempt.
    }

    const legacyResult = await this.#decryptLegacy(encryptedStateData);
    if (!legacyResult) return undefined;

    const { session: legacyData, iat } = legacyResult;
    const stateData = this.#transformer.transformLegacySession(legacyData);
    if (iat !== undefined) {
      stateData.internal.createdAt = iat;
    }
    return stateData as TData;
  }

  /**
   * Decrypts data using express-openid-connect's encryption method (A256GCM with HKDF).
   * Tries each secret in order; the first successful decryption wins (key rotation support).
   * Returns the session payload and the header `iat`, or undefined if all secrets fail.
   */
  async #decryptLegacy(encryptedData: string): Promise<{ session: ExpressOpenidConnectSession; iat?: number } | undefined> {
    for (const secret of this.#legacySecrets) {
      try {
        const key = await this.#deriveLegacyKey(secret);
        const { payload, protectedHeader } = await jwtDecrypt(encryptedData, key, {
          contentEncryptionAlgorithms: ['A256GCM'],
          keyManagementAlgorithms: ['dir'],
        });

        const header = protectedHeader as JWEHeaderParameters & Record<string, unknown>;

        // Check header-level exp (express-openid-connect stores exp in JWE header, not payload).
        // A genuine express-openid-connect cookie always carries a numeric exp; reject a cookie
        // that lacks one or is expired, mirroring appSession's `exp > epoch()` assertion rather
        // than accepting an exp-less cookie indefinitely.
        // Reject once exp has been reached, mirroring appSession's `exp > epoch()` assertion
        // (i.e. invalid when `exp <= now`), not one second later.
        const headerExp = header.exp;
        if (typeof headerExp !== 'number' || headerExp <= Math.floor(Date.now() / 1000)) {
          return undefined;
        }

        const headerIat = header.iat;
        return {
          session: payload as ExpressOpenidConnectSession,
          iat: typeof headerIat === 'number' ? headerIat : undefined,
        };
      } catch (err) {
        if (!(err instanceof errors.JWEDecryptionFailed) && !(err instanceof errors.JWEInvalid)) {
          throw err;
        }
        continue;
      }
    }

    return undefined;
  }

  async #deriveLegacyKey(secret: string): Promise<Uint8Array> {
    return deriveHkdfKey(secret, 'JWE CEK');
  }
}
