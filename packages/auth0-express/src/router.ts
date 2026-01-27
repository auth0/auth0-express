import { Router, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import type { Auth0ExpressOptions } from './types.js';
import { createServerClientInstance } from './utils.js';
import { handleLogin } from './handlers/login-handler.js';
import { handleCallback } from './handlers/callback-handler.js';
import { handleLogout } from './handlers/logout-handler.js';
import { handleBackchannelLogout } from './handlers/backchannel-logout-handler.js';
import './types/express.js';

export function createAuth0Router(options: Auth0ExpressOptions): Router {
  const router = Router();

  // 1. Cookie parsing
  router.use(cookieParser());

  // 2. Initialize auth0Client
  const auth0Client = createServerClientInstance(options);

  // Attach to request
  router.use((req: Request, res: Response, next: NextFunction) => {
    req.auth0 = { client: auth0Client };
    req.app.locals.auth0Client = auth0Client;
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

    router.get(routes.login, (req, res) => handleLogin(req, res, options));
    router.get(routes.callback, (req, res) => handleCallback(req, res, options));
    router.get(routes.logout, (req, res) => handleLogout(req, res, options));
    router.post(routes.backchannelLogout, (req, res) => handleBackchannelLogout(req, res));
  }

  return router;
}
