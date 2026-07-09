import { Router, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import type { Auth0Options } from './types.js';
import { createServerClientInstance } from './utils.js';
import { handleLogin } from './handlers/login-handler.js';
import { handleCallback } from './handlers/callback-handler.js';
import { handleLogout } from './handlers/logout-handler.js';
import { handleBackchannelLogout } from './handlers/backchannel-logout-handler.js';
import { runWithContext } from './store/request-context.js';
import { getConfig } from './config.js';
import './types/express.js';

/**
 * Creates an Express router with Auth0 authentication middleware.
 *
 * This is the main entry point for the Auth0 Express SDK. It configures
 * authentication routes and attaches the Auth0 client to the request object.
 *
 * @param opts - Configuration options for Auth0 authentication
 * @returns Express Router configured with Auth0 authentication
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createAuth0 } from '@auth0/auth0-express';
 *
 * const app = express();
 *
 * // Using environment variables (AUTH0_DOMAIN, AUTH0_CLIENT_ID, etc.)
 * app.use(createAuth0());
 *
 * // Or with explicit configuration
 * app.use(createAuth0({
 *   domain: 'tenant.auth0.com',
 *   clientId: 'your_client_id',
 *   clientSecret: 'your_client_secret',
 *   appBaseUrl: 'http://localhost:3000',
 *   sessionSecret: process.env.SESSION_SECRET
 * }));
 * ```
 */
export function createAuth0(opts: Partial<Auth0Options> = {}): Router {
  const options = getConfig(opts);
  const router = Router();

  // Cookie parsing
  router.use(cookieParser());

  // Establish AsyncLocalStorage context for the request lifecycle
  router.use((request: Request, response: Response, next: NextFunction) => {
    runWithContext({ request, response }, () => next());
  });

  // Initialize auth0Client
  const auth0Client = createServerClientInstance(options);

  // Attach to request
  router.use((req: Request, res: Response, next: NextFunction) => {
    req.auth0 = { client: auth0Client };
    req.app.locals.auth0Client = auth0Client;
    req.app.locals.auth0ClientOptions = options;
    req.app.locals.appBaseUrl = options.appBaseUrl;
    req.app.locals.pushedAuthorizationRequests = options.pushedAuthorizationRequests;
    next();
  });

  // Mount routes
  const shouldMountRoutes = options.mountRoutes ?? true;

  if (shouldMountRoutes) {
    const routes = {
      login: options.routes?.login ?? '/auth/login',
      callback: options.routes?.callback ?? '/auth/callback',
      logout: options.routes?.logout ?? '/auth/logout',
      backchannelLogout: options.routes?.backchannelLogout ?? '/auth/backchannel-logout',
    };

    router.get(routes.login, (req, res, next) => handleLogin(req, res, options, next));
    router.get(routes.callback, (req, res, next) => handleCallback(req, res, options, next));
    router.get(routes.logout, (req, res, next) => handleLogout(req, res, options, next));
    router.post(routes.backchannelLogout, (req, res, next) => handleBackchannelLogout(req, res, next));
  }

  return router;
}
