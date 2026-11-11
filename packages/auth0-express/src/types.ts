import type {
  AnonymousCookieOptions,
  AnonymousStore,
  DiscoveryCacheOptions,
  DomainResolver,
  PoppyConfig,
  PoppyGuestCookieOptions,
  PoppyGuestStore,
  PoppyProtectedResource,
  SessionConfiguration,
  SessionStore,
  UserClaims,
} from '@auth0/auth0-server-js';
import type { Request, Response } from 'express';

export type {
  AnonymousCookieOptions,
  AnonymousSessionData,
  AnonymousStateData,
  AnonymousStore,
  AnonymousTokenSet,
  CreateAnonymousSessionOptions,
  DiscoveryCacheOptions,
  DomainResolver,
  GetAnonymousAccessTokenOptions,
  PoppyActClaim,
  PoppyAgentContext,
  PoppyConfig,
  PoppyConfigIssue,
  PoppyContext,
  PoppyGuestCookieOptions,
  PoppyGuestData,
  PoppyGuestStore,
  PoppyProtectedResource,
  PoppyVisitor,
  UserClaims,
} from '@auth0/auth0-server-js';

/**
 * Options for anonymous sessions. All anonymous session configuration is nested here.
 */
export interface AnonymousSessionsOptions {
  /**
   * Custom anonymous session store (e.g. Redis-backed).
   * When provided, the built-in `StatelessAnonymousStore` is not created.
   */
  store?: AnonymousStore<StoreOptions>;
  /**
   * Cookie name (and store key) for the anonymous session.
   * @default '__a0_anon'
   */
  identifier?: string;
  /**
   * Whether to discard the anonymous session once the visitor logs in.
   * Set to `false` if you need to read the anonymous identity at login time
   * (e.g. to merge a guest cart) — in that case call `client.anonymous.logout()`
   * yourself after merging.
   * @default true
   */
  clearOnLogin?: boolean;
  /**
   * Lifetime of the anonymous session in seconds. Should match
   * `sessions.anonymous.lifetime_in_minutes * 60` on your Auth0 tenant.
   * Only applies when using the built-in store (i.e. `store` is not set).
   * @default 2592000 (30 days)
   */
  sessionTokenLifetime?: number;
  /**
   * Cookie attributes for the anonymous session cookie.
   * Only applies when using the built-in store (i.e. `store` is not set).
   *
   * **`path` warning:** keep the default `/`. Setting a subpath (e.g. `/app`) scopes the cookie
   * away from the auth routes (`/auth/login`, `/auth/callback`), so the browser will not send it
   * there. This silently disables anonymous-to-authenticated linking at login and the
   * `clearOnLogin` behaviour at callback. Only use a subpath if your auth routes are also
   * mounted under that same path.
   */
  cookie?: AnonymousCookieOptions;
}

/**
 * Options for Poppy (Personal Agent Protocol).
 *
 * @beta
 */
export interface PoppyOptions {
  /**
   * The parsed `auth0-poppy.json` file. When set, no file is read and `configPath` is ignored.
   */
  config?: PoppyConfig;
  /**
   * Where to read `auth0-poppy.json` from: a path, or a `file:` URL object. A relative path is resolved against
   * `process.cwd()` once, when `createAuth0()` runs, so an app that starts from another folder must set this.
   * @default 'auth0-poppy.json'
   */
  configPath?: string | URL;
  /**
   * Custom guest store (e.g. Redis-backed). A guest is an agent's browser that joined without signing in, and it
   * is kept apart from the user session.
   * When provided, the built-in `StatelessPoppyGuestStore` is not created and `cookie` is ignored.
   * The store is called without `StoreOptions`, so its methods do not get the Express request.
   */
  guestStore?: PoppyGuestStore<StoreOptions>;
  /**
   * Cookie attributes for the guest cookie.
   * Only applies when using the built-in store (i.e. `guestStore` is not set).
   * The guest cookie does not follow `sessionConfiguration.cookie`. Its defaults are `sameSite: 'lax'`,
   * `secure: true` and `path: '/'`.
   */
  cookie?: PoppyGuestCookieOptions;
  /**
   * The longest an agent's session on your website lasts, in seconds. The session can end sooner, when the
   * agent's Poppy Session does.
   * @default 7200 (two hours)
   */
  agentSessionMaxAge?: number;
  /**
   * Your own values for the `oauth-protected-resource` document that your website serves
   * ({@link https://www.rfc-editor.org/rfc/rfc9728#section-2 RFC 9728, section 2}). A member you give is served
   * as it is. A member you leave out is inferred from the config.
   */
  protectedResource?: PoppyProtectedResource;
}

/**
 * Hook called after the OAuth callback completes in Enterprise Connect mode.
 * Auth0 writes no session cookie; the app must write its own here and call
 * res.redirect() (or equivalent) before the promise resolves.
 *
 * Required when `enterpriseConnect: true`.
 */
export type EnterpriseConnectCallbackHook = (
  req: Request,
  res: Response,
  result: {
    idTokenClaims?: Record<string, unknown>;
    user?: UserClaims;
    appState?: unknown;
  }
) => Promise<void>;

/**
 * Options passed to custom session store implementations.
 *
 * These options provide access to the Express request and response objects,
 * which are needed for cookie and session management operations.
 *
 * @example
 * ```typescript
 * class CustomSessionStore implements SessionStore<StoreOptions> {
 *   async get(id: string, options: StoreOptions) {
 *     const { request, response } = options;
 *     // Access cookies, headers, etc.
 *   }
 * }
 * ```
 */
export interface StoreOptions {
  /** Express request object */
  request: Request;
  /** Express response object */
  response: Response;
}

/**
 * Configuration options for Auth0 authentication in Express applications.
 *
 * Environment variable support:
 * - AUTH0_DOMAIN or ISSUER_BASE_URL: Auth0 domain
 * - AUTH0_CLIENT_ID or CLIENT_ID: Client ID
 * - AUTH0_CLIENT_SECRET or CLIENT_SECRET: Client secret
 * - APP_BASE_URL or BASE_URL: Application base URL
 * - AUTH0_SESSION_SECRET or SECRET: Session encryption secret
 * - AUTH0_AUDIENCE: Optional API audience
 *
 * @example
 * ```typescript
 * const options: Auth0Options = {
 *   domain: 'tenant.auth0.com',
 *   clientId: 'your_client_id',
 *   clientSecret: 'your_client_secret',
 *   appBaseUrl: 'http://localhost:3000',
 *   sessionSecret: process.env.SESSION_SECRET
 * };
 * ```
 */
export interface Auth0Options {
  /**
   * Auth0 domain (e.g., 'tenant.auth0.com') without protocol.
   *
   * Provide a `DomainResolver` function to resolve the Auth0 custom domain
   * per request (Multiple Custom Domains). The resolver receives the Express
   * request context (`{ request, response }`) and returns the domain string.
   */
  domain: string | DomainResolver<StoreOptions>;
  /** Auth0 application client ID */
  clientId: string;
  /** Auth0 application client secret (required for token exchange) */
  clientSecret?: string;
  /** Private key for client assertion authentication (alternative to clientSecret) */
  clientAssertionSigningKey?: string | CryptoKey;
  /** Algorithm for client assertion signing (e.g., 'RS256') */
  clientAssertionSigningAlg?: string;
  /** API audience for requesting access tokens */
  audience?: string;
  /**
   * Base URL of your application (e.g., 'http://localhost:3000').
   *
   * - Provide a single URL string for a static base URL (default behavior).
   * - Provide an array of allowed URLs to validate the incoming request origin
   *   against an allow-list (recommended for dynamic/preview deployments).
   * - Omit it (or set `APP_BASE_URL`/`BASE_URL` empty) to infer the base URL
   *   from the incoming request host at runtime.
   */
  appBaseUrl?: string | string[];

  /** Enable Pushed Authorization Requests (PAR) for enhanced security */
  pushedAuthorizationRequests?: boolean;

  /**
   * Secret for encrypting session cookies (minimum 32 characters recommended).
   *
   * Provide an array to support secret rotation: the first secret is used to encrypt new
   * cookies, while all secrets are tried, in order, when decrypting. This lets you roll the
   * secret without logging existing users out — deploy `[newSecret, oldSecret]`, then drop
   * the old secret once every session has been re-encrypted under the new one.
   *
   * Via environment variables, a comma-separated `AUTH0_SESSION_SECRET` (or `SECRET`) is
   * parsed into an array in the same order.
   */
  sessionSecret: string | string[];
  /** Custom session store implementation (defaults to cookie-based sessions) */
  sessionStore?: SessionStore<StoreOptions>;
  /** Advanced session configuration (cookie settings, timeouts, etc.) */
  sessionConfiguration?: SessionConfiguration;

  /**
   * Legacy compatibility options for migrating from express-openid-connect.
   * When set, the SDK will automatically detect and decrypt sessions from
   * express-openid-connect, allowing seamless migration without forcing users to re-authenticate.
   */
  legacyCompatibility?: {
    /**
     * The secret(s) that were used by express-openid-connect for session encryption.
     * Supports key rotation: provide an array to try multiple secrets in order.
     * If not provided, uses the same secret as the current sessionSecret.
     */
    legacySecret?: string | string[];

    /**
     * The audience to assign to access tokens migrated from express-openid-connect sessions.
     *
     * Token sets are looked up by audience, so this must equal the `audience` your app requests
     * (e.g. via `getAccessToken`) or the migrated access token will not be found. The default
     * `'default'` only matches callers that request no audience.
     *
     * @default 'default'
     */
    legacyAudience?: string;

    /**
     * The scope to assign to access tokens migrated from express-openid-connect sessions.
     * @default 'openid profile email offline_access'
     */
    legacyScope?: string;

    /**
     * Mirror of express-openid-connect's `requireSignedSessionStoreCookie`. Only applies when a
     * server-side `sessionStore` is configured (stateful sessions); ignored for cookie-based
     * (stateless) sessions, whose payload is already encrypted and authenticated.
     *
     * When `true`, a legacy session-store cookie is only honored if it carries a valid JWS
     * signature (verified against one of {@link legacySecret}); an unsigned cookie or one whose
     * signature does not verify resolves to no session instead of being used verbatim as the
     * store key. Set this when migrating a deployment that ran express-openid-connect with
     * `requireSignedSessionStoreCookie: true`, so the signature remains the required integrity
     * control over the store key.
     *
     * @default false
     */
    requireSignedLegacyCookie?: boolean;
  };
  /**
   * Whether to mount the default routes for login, logout, callback and backchannel logout.
   * Routes: /auth/login, /auth/callback, /auth/logout, /auth/backchannel-logout
   * With `poppy` set, `mountRoutes: false` also turns off the two Poppy discovery files
   * (`/.well-known/poppy.json` and `/.well-known/oauth-protected-resource`).
   * @default true
   */
  mountRoutes?: boolean;
  /**
   * Custom fetch implementation for HTTP requests.
   * Useful for proxies, custom headers, or testing.
   */
  customFetch?: typeof fetch;

  /**
   * Optional discovery cache configuration for OIDC metadata and JWKS.
   * `ttl` is in seconds. Cache entries are scoped per resolved domain, which
   * matters for MCD deployments serving many domains. Defaults to the
   * `ServerClient` defaults (TTL 600s, max 100 entries) when omitted.
   */
  discoveryCache?: DiscoveryCacheOptions;

  /**
   * Enable anonymous sessions. Set to `true` to use all defaults, or provide an options
   * object to configure the store, cookie lifetime, cookie attributes, identifier, and
   * login behaviour.
   *
   * When set, `req.auth0.client.anonymous` becomes available for creating and managing
   * anonymous sessions. The store is encrypted with the same `sessionSecret` used for
   * user sessions (when using the built-in store).
   *
   * @example
   * ```typescript
   * // Default settings — built-in JWE cookie store, 30-day lifetime
   * app.use(createAuth0({ sessionSecret: '...', anonymousSessions: true }));
   *
   * // Custom lifetime
   * app.use(createAuth0({
   *   sessionSecret: '...',
   *   anonymousSessions: { sessionTokenLifetime: 7 * 24 * 60 * 60 },
   * }));
   *
   * // Custom store + identifier
   * app.use(createAuth0({
   *   sessionSecret: '...',
   *   anonymousSessions: { store: new RedisAnonymousStore(), identifier: '__a0_anon' },
   * }));
   *
   * // Keep anonymous session after login (e.g. to merge a guest cart)
   * app.use(createAuth0({
   *   sessionSecret: '...',
   *   anonymousSessions: { clearOnLogin: false },
   * }));
   * ```
   */
  anonymousSessions?: true | AnonymousSessionsOptions;

  /**
   * Enable Poppy (Personal Agent Protocol) support, so that an agent can browse your website
   * ({@link https://personalagentprotocol.org/docs/0.3/spec#web-browsing section 6 of the specification}).
   * Set to `true` to use all defaults (the same as `{}`), or provide an options object. Without it, nothing
   * changes.
   *
   * When set, `req.auth0.client.poppy` becomes available. `createAuth0()` reads `auth0-poppy.json` once, at
   * startup, unless you pass the parsed file as `config`. A guest, which is an agent's browser that joined
   * without signing in, is kept in its own cookie, apart from the user session. The cookie is encrypted with the
   * same `sessionSecret` (when using the built-in store).
   *
   * It needs a static string `domain`. A domain resolver and `enterpriseConnect` are not supported with `poppy`: both
   * are startup errors.
   *
   * @beta
   * @example
   * ```typescript
   * // Read auth0-poppy.json from the working directory
   * app.use(createAuth0({ sessionSecret: '...', poppy: true }));
   *
   * // Read it from another place
   * app.use(createAuth0({
   *   sessionSecret: '...',
   *   poppy: { configPath: './config/auth0-poppy.json' },
   * }));
   *
   * // Pass the parsed file, and read no file
   * app.use(createAuth0({ sessionSecret: '...', poppy: { config: poppyConfig } }));
   *
   * // In a route: const visitor = await req.auth0.client.poppy.getVisitor();
   * ```
   */
  poppy?: true | PoppyOptions;

  /**
   * Put the SDK in Enterprise Connect mode. Auth0 acts as a pure SSO relay;
   * no Auth0 session is written. `onCallback` is required in this mode.
   */
  enterpriseConnect?: boolean;

  /**
   * Required when `enterpriseConnect: true`. Called after code exchange with
   * the ID token claims. Write your own session here and call res.redirect().
   */
  onCallback?: EnterpriseConnectCallbackHook;

  /** Custom paths for authentication routes (only used if mountRoutes is true) */
  routes?: {
    /** Login route path @default '/auth/login' */
    login?: string;
    /** OAuth callback route path @default '/auth/callback' */
    callback?: string;
    /** Logout route path @default '/auth/logout' */
    logout?: string;
    /** Backchannel logout route path @default '/auth/backchannel-logout' */
    backchannelLogout?: string;
  };
}
