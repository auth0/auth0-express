import { StatelessStateStore, SessionConfiguration } from '@auth0/auth0-server-js';
import type { CookieHandler, StateData } from '@auth0/auth0-server-js';
import { jwtDecrypt } from 'jose';
import type { JWEHeaderParameters } from 'jose';
import { LegacySessionTransformer } from './legacy-session-transformer.js';
import type { ExpressOpenidConnectSession } from './legacy-session-transformer.js';

/**
 * Options for creating a legacy-compatible stateless state store
 */
export interface LegacyCompatibleStoreOptions {
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
 * A stateless state store that provides backward compatibility with express-openid-connect sessions.
 *
 * This store extends StatelessStateStore from auth0-server-js and overrides the decrypt method
 * to attempt legacy decryption when modern decryption fails. This allows seamless migration from
 * express-openid-connect without forcing users to re-authenticate.
 *
 * Key differences between express-openid-connect and auth0-server-js encryption:
 * - express-openid-connect uses A256GCM encryption algorithm
 * - auth0-server-js uses A256CBC-HS512 encryption algorithm
 * - Different HKDF key derivation parameters
 *
 * @example
 * ```typescript
 * import { LegacyCompatibleStatelessStateStore } from '@auth0/auth0-express';
 * import { ExpressCookieHandler } from './express-cookie-handler';
 *
 * const store = new LegacyCompatibleStatelessStateStore(
 *   {
 *     secret: process.env.SESSION_SECRET,
 *     legacySecret: process.env.SESSION_SECRET, // Same secret if not changed
 *     legacyAudience: 'https://api.example.com',
 *     legacyScope: 'openid profile email',
 *   },
 *   new ExpressCookieHandler()
 * );
 * ```
 */
export class LegacyCompatibleStatelessStateStore<TStoreOptions> extends StatelessStateStore<TStoreOptions> {
  readonly #legacySecrets: string[];
  readonly #transformer: LegacySessionTransformer;

  constructor(options: LegacyCompatibleStoreOptions, cookieHandler: CookieHandler<TStoreOptions>) {
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
   * super.decrypt() throws for all failures. We attempt modern decryption first and, on any error,
   * fall back to the legacy express-openid-connect decryption. If legacy decryption also fails,
   * we return undefined (the correct contract for unreadable session cookies).
   */
  protected override async decrypt<TData>(
    identifier: string,
    encryptedStateData: string
  ): Promise<TData> {
    try {
      return await super.decrypt<TData>(identifier, encryptedStateData);
    } catch (modernError) {
      // Modern decryption failed — try legacy express-openid-connect decryption.
      try {
        const { session: legacyData, iat } = await this.#decryptLegacy(encryptedStateData);
        const stateData = this.#transformer.transformLegacySession(legacyData);
        // Use the JWE header iat as createdAt so the session's absolute duration
        // is preserved correctly after migration (rather than resetting to now).
        if (iat !== undefined) {
          stateData.internal.createdAt = iat;
        }
        return stateData as TData;
      } catch {
        // If both fail, throw the original modern error
        throw modernError;
      }
    }
  }

  /**
   * Decrypts data using express-openid-connect's encryption method (A256GCM with HKDF).
   * Tries each secret in order; the first successful decryption wins (key rotation support).
   * Returns the session payload and the header `iat` (session creation time, if present).
   */
  async #decryptLegacy(encryptedData: string): Promise<{ session: ExpressOpenidConnectSession; iat?: number }> {
    let lastError: unknown;

    for (const secret of this.#legacySecrets) {
      try {
        const key = await this.#deriveLegacyKey(secret);
        const { payload, protectedHeader } = await jwtDecrypt(encryptedData, key, {
          contentEncryptionAlgorithms: ['A256GCM'],
          keyManagementAlgorithms: ['dir'],
        });

        const header = protectedHeader as JWEHeaderParameters & Record<string, unknown>;

        // Check header-level exp (express-openid-connect stores exp in JWE header, not payload).
        const headerExp = header.exp;
        if (typeof headerExp === 'number' && headerExp < Math.floor(Date.now() / 1000)) {
          throw new Error('Legacy session expired');
        }

        const headerIat = header.iat;
        return {
          session: payload as ExpressOpenidConnectSession,
          iat: typeof headerIat === 'number' ? headerIat : undefined,
        };
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    throw lastError;
  }

  /**
   * Derives an encryption key using express-openid-connect's HKDF approach.
   * This matches the encryption key derivation from express-openid-connect.
   */
  async #deriveLegacyKey(secret: string): Promise<Uint8Array> {
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
        salt: new Uint8Array(0), // express-openid-connect uses empty salt
      } as HkdfParams,
      keyMaterial,
      BYTE_LENGTH * 8 // Convert bytes to bits
    );

    return new Uint8Array(derivedBits);
  }
}
