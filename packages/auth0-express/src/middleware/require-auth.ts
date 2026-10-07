import { Request, Response, NextFunction } from 'express';

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
}

/**
 * Middleware to require authentication for a route.
 *
 * If the user is not authenticated:
 * - For HTML requests (browser): Redirects to /auth/login with returnTo parameter
 * - For API requests (JSON): Returns 401 Unauthorized
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
      const user = await req.auth0.client.getUser();

      if (!user) {
        // Check if this is an API request (wants JSON response)
        const acceptsJson = req.accepts('json') && !req.accepts('html');

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
