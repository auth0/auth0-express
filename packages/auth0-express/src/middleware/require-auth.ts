import { Request, Response, NextFunction } from 'express';
import { readUser } from './read-user.js';

/**
 * Options for the requiresAuth middleware.
 */
export interface RequiresAuthOptions {
  /**
   * If true, returns a 401 status instead of redirecting to login.
   * Useful for API routes that should not redirect.
   *
   * Default: false (redirects to login)
   */
  returnTo?: string;
  /**
   * Called when the request comes from an agent's browser that joined as a guest, which is a browser with no user
   * (Poppy, beta). It only applies when the `poppy` option is set.
   *
   * A guest is never sent to the login route. A guest cannot sign in on your website: the person the agent acts for
   * signs in through the agent, and the agent then joins again. Auth0 can keep the anonymous session of the join for
   * single sign-on, so the login route can bring back the same guest. A login cannot sign a guest in as a user, so a
   * redirect is no use.
   *
   * Answer the request, or call `next()` to let the route run. Without this handler, the middleware answers a guest
   * with `403` and a short message, as JSON for an API client.
   */
  onGuest?: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

/**
 * Middleware to require authentication for a route.
 *
 * If the user is not authenticated:
 * - For HTML requests (browser): Redirects to /auth/login with returnTo parameter
 * - For API requests (JSON): Returns 401 Unauthorized
 * - For a guest, an agent's browser that joined without a user (with the `poppy` option): never redirects. Calls
 *   `onGuest`, or answers 403.
 *
 * @param options - Optional configuration for the middleware
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Protect a route
 * app.get('/profile', requiresAuth(), (req, res) => {
 *   res.json({ user: await req.auth0.client.getUser() });
 * });
 *
 * // Protect an API route (returns 401 instead of redirecting)
 * app.get('/api/me', requiresAuth(), async (req, res) => {
 *   const user = await req.auth0.client.getUser();
 *   res.json({ user });
 * });
 *
 * // Custom return URL after login
 * app.get('/admin', requiresAuth({ returnTo: '/admin' }), (req, res) => {
 *   res.send('Admin page');
 * });
 * ```
 *
 * **Enterprise Connect mode:** Do NOT use `requiresAuth()` when `enterpriseConnect: true`.
 * `getUser()` is blocked in EC mode and will throw `EnterpriseConnectNotSupportedError`.
 * Use your own session middleware (checking your app-owned session cookie) instead.
 */
export function requiresAuth(options?: RequiresAuthOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // A guest cannot sign in here: a login cannot sign a guest in as a user, so a redirect is no use. `readUser()` is
      // one read that tells a guest, a user and nobody apart, and it looks for the guest first (see there).
      const { user, guest } = await readUser(req);

      // Check if this is an API request (wants JSON response)
      const acceptsJson = req.accepts('json') && !req.accepts('html');

      if (guest) {
        if (options?.onGuest) {
          return await options.onGuest(req, res, next);
        }

        return acceptsJson
          ? res.status(403).json({ error: 'forbidden', message: 'A signed-in user is required' })
          : res.status(403).type('text/plain').send('A signed-in user is required.');
      }

      if (!user) {
        if (acceptsJson) {
          return res.status(401).json({
            error: 'unauthorized',
            message: 'Authentication required',
          });
        }

        // For HTML requests, redirect to login with returnTo
        const returnTo = options?.returnTo || req.originalUrl;
        const loginPath = req.app.locals.auth0ClientOptions?.routes?.login || '/auth/login';
        const loginUrl = `${loginPath}?returnTo=${encodeURIComponent(returnTo)}`;
        return res.redirect(loginUrl);
      }

      // User is authenticated, continue
      next();
    } catch (error) {
      next(error);
    }
  };
}
