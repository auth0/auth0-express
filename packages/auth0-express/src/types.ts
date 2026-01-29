import { SessionConfiguration, SessionStore } from '@auth0/auth0-server-js';
import type { Request, Response } from 'express';

export interface StoreOptions {
  request: Request;
  response: Response;
}

/**
 * Options for configuring the Auth0 Express SDK.
 */
export interface Auth0Options {
  domain: string;
  clientId: string;
  clientSecret?: string;
  clientAssertionSigningKey?: string | CryptoKey;
  clientAssertionSigningAlg?: string;
  audience?: string;
  appBaseUrl: string;

  pushedAuthorizationRequests?: boolean;

  sessionSecret: string;
  sessionStore?: SessionStore<StoreOptions>;
  sessionConfiguration?: SessionConfiguration;
  /**
   * Whether to mount the default routes for login, logout, callback and profile.
   * Defaults to true.
   */
  mountRoutes?: boolean;
  /**
   * Optional, custom Fetch implementation to use.
   */
  customFetch?: typeof fetch;

  routes?: {
    login?: string;
    callback?: string;
    logout?: string;
    backchannelLogout?: string;
  };
}
