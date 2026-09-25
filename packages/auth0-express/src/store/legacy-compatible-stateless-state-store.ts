import { StatelessStateStore, SessionConfiguration } from '@auth0/auth0-server-js';
import type { CookieHandler } from '@auth0/auth0-server-js';
import { jwtDecrypt, errors, decodeProtectedHeader } from 'jose';
import type { JWEHeaderParameters } from 'jose';
import { LegacySessionTransformer, warnIfAbsoluteDurationUnset } from './legacy-session-transformer.js';
import type { ExpressOpenidConnectSession } from './legacy-session-transformer.js';
import { deriveHkdfKey } from './express-oidc-hkdf.js';

/**
 * Options for {@link MigrationStatelessStateStore}.
 */
export interface MigrationStatelessStateStoreOptions {
  /**
   * The secret used by auth0-server-js for encryption.
   *
   * Provide an array to support secret rotation: the first secret encrypts new cookies, while
   * all secrets are tried, in order, when decrypting.
   */
  secret: string | string[];

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
 * derived, info `"JWE CEK"`). `auth0-server-js` uses `A256CBC-HS512` and stamps a `kid` in the
 * JWE protected header. This store routes on that marker: a cookie whose header carries a `kid`
 * is a modern cookie and is decrypted by the base store; a cookie with no `kid` is a legacy
 * `express-openid-connect` cookie and is decrypted with the legacy scheme, then transformed into
 * {@link StateData}. Routing by format (rather than "try modern, then guess from the error") keeps
 * a genuine runtime fault from being masked as a legacy-cookie miss.
 *
 * Once the user's next request writes back the session, the cookie is re-encrypted in the
 * modern format (gaining a `kid`) and the legacy path is no longer exercised for that user.
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

    // Fall back to the app's session secret(s) when no explicit legacy secret is given. Either
    // may be an array (rotation), so normalize both to a flat string[] tried in order.
    const legacySecret = options.legacySecret ?? options.secret;
    this.#legacySecrets = Array.isArray(legacySecret) ? legacySecret : [legacySecret];

    const legacyAudience = options.legacyAudience ?? 'default';
    const legacyScope = options.legacyScope ?? 'openid profile email offline_access';
    this.#transformer = new LegacySessionTransformer(legacyAudience, legacyScope);

    warnIfAbsoluteDurationUnset(options.sessionConfiguration);
  }

  /**
   * Decrypts a session cookie, routing strictly by cookie format.
   *
   * A modern auth0-server-js cookie is a compact JWE whose protected header carries a `kid`
   * (auth0-server-js derives the per-cookie encryption secret from it and rejects a cookie that
   * lacks one). A legacy express-openid-connect cookie is an A256GCM JWE with no `kid`.
   *
   * - **Modern cookie** (`kid` present): delegate to {@link StatelessStateStore.decrypt}. A jose
   *   error there ({@link errors.JOSEError} — wrong key, expired, malformed) means the cookie
   *   cannot be read, so we resolve to `undefined` ("logged out"), matching the base. A non-jose
   *   error (e.g. a `TypeError` from a broken Web Crypto runtime) is a genuine fault, not a format
   *   signal, so it propagates rather than being masked as a legacy-cookie miss.
   * - **Legacy cookie** (no `kid`, or anything not parseable as a compact JWE): decrypt with the
   *   express-openid-connect scheme and transform the result into {@link StateData}.
   *
   * This is the cookie-store analogue of the stateful store routing by dot-count: a modern cookie
   * is never fed to the legacy decoder and vice versa.
   */
  protected override async decrypt<TData>(
    identifier: string,
    encryptedStateData: string
  ): Promise<TData | undefined> {
    if (this.#isModernCookie(encryptedStateData)) {
      try {
        return await super.decrypt<TData>(identifier, encryptedStateData);
      } catch (err) {
        // A jose error means the modern cookie cannot be decrypted (wrong key / expired /
        // malformed) — resolve to undefined like the base store. Anything else is a genuine fault
        // and must propagate rather than be silently swallowed and surface as "logged out".
        if (err instanceof errors.JOSEError) {
          return undefined;
        }
        throw err;
      }
    }

    const legacyResult = await this.#decryptLegacy(encryptedStateData);
    if (!legacyResult) return undefined;

    const { session: legacyData, iat } = legacyResult;
    const stateData = this.#transformer.transformLegacySession(legacyData);
    if (iat !== undefined) {
      stateData.internal.createdAt = iat;

      // Enforce this SDK's absoluteDuration on read. A migrated cookie still carries
      // express-openid-connect's own Max-Age/exp (the OLD deployment's window), so unlike a modern
      // cookie the browser does not stop sending it at this SDK's cap and there is no modern `exp`
      // to reject it. `calculateMaxAge(iat) <= 0` means the session is already past
      // `createdAt + absoluteDuration`: treat it as expired and return no session rather than
      // honoring it until the next write.
      if (this.calculateMaxAge(iat) <= 0) {
        return undefined;
      }
    }
    return stateData as TData;
  }

  /**
   * Returns true when the value is a compact JWE whose protected header carries a non-empty `kid`
   * — the marker auth0-server-js stamps on every modern cookie. A legacy express-openid-connect
   * cookie has no `kid`, and a value that is not a well-formed compact JWE cannot be parsed; both
   * return false and are routed to the legacy decoder.
   */
  #isModernCookie(value: string): boolean {
    try {
      const header = decodeProtectedHeader(value);
      return typeof header.kid === 'string' && header.kid.length > 0;
    } catch {
      // Not a well-formed compact JWE — it cannot be a modern auth0-server-js cookie.
      return false;
    }
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

        // Check header-level exp (express-openid-connect stores exp in the JWE header, not the
        // payload). A genuine express-openid-connect cookie always carries a numeric exp; reject a
        // cookie that lacks one, rather than accepting an exp-less cookie indefinitely. Reject once
        // exp has been reached, mirroring appSession's `exp > epoch()` assertion (i.e. invalid when
        // `exp <= now`), not one second later.
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
        // Swallow any JOSE-level failure and try the next secret / fall through to "no session".
        // Besides the expected JWEDecryptionFailed / JWEInvalid (wrong key or malformed JWE), a
        // modern auth0-server-js cookie (A256CBC-HS512) fed into this A256GCM-only path throws
        // JOSEAlgNotAllowed. All jose errors extend JOSEError, so this fails soft to `undefined`
        // ("logged out"), matching the base store, while genuine programming errors (e.g.
        // TypeError from a broken Web Crypto) are not JOSEError and still propagate.
        if (!(err instanceof errors.JOSEError)) {
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
