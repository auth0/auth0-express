import { SessionConfiguration, SessionStore } from '@auth0/auth0-server-js';
import type { Request, Response } from 'express';

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
  /** Auth0 domain (e.g., 'tenant.auth0.com') without protocol */
  domain: string;
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
  /** Base URL of your application (e.g., 'http://localhost:3000') */
  appBaseUrl: string;

  /** Enable Pushed Authorization Requests (PAR) for enhanced security */
  pushedAuthorizationRequests?: boolean;

  /** Secret for encrypting session cookies (minimum 32 characters recommended) */
  sessionSecret: string;
  /** Custom session store implementation (defaults to cookie-based sessions) */
  sessionStore?: SessionStore<StoreOptions>;
  /** Advanced session configuration (cookie settings, timeouts, etc.) */
  sessionConfiguration?: SessionConfiguration;

  /**
   * Legacy compatibility options for migrating from express-openid-connect.
   * When enabled, the SDK will automatically detect and decrypt sessions from
   * express-openid-connect, allowing seamless migration without forcing users to re-authenticate.
   */
  legacyCompatibility?: {
    /**
     * Enable legacy session compatibility with express-openid-connect.
     * @default false
     */
    enabled: boolean;

    /**
     * The secret(s) that were used by express-openid-connect for session encryption.
     * Supports key rotation: provide an array to try multiple secrets in order.
     * If not provided, uses the same secret as the current sessionSecret.
     */
    legacySecret?: string | string[];

    /**
     * The audience to assign to access tokens migrated from express-openid-connect sessions.
     * @default 'default'
     */
    legacyAudience?: string;

    /**
     * The scope to assign to access tokens migrated from express-openid-connect sessions.
     * @default 'openid profile email offline_access'
     */
    legacyScope?: string;
  };
  /**
   * Whether to mount the default routes for login, logout, callback and backchannel logout.
   * Routes: /auth/login, /auth/callback, /auth/logout, /auth/backchannel-logout
   * @default true
   */
  mountRoutes?: boolean;
  /**
   * Custom fetch implementation for HTTP requests.
   * Useful for proxies, custom headers, or testing.
   */
  customFetch?: typeof fetch;

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
