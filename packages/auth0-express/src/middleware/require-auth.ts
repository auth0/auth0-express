import { Request, Response, NextFunction } from 'express';

/**
 * Options for the requireAuth middleware.
 */
export interface RequireAuthOptions {
  /**
   * If true, returns a 401 status instead of redirecting to login.
   * Useful for API routes that should not redirect.
   *
   * Default: false (redirects to login)
   */
  returnTo?: string;

  /**
   * Custom error message to send when authentication is required.
   * Only used when the request expects JSON (API request).
   */
  errorMessage?: string;
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
 * app.get('/profile', requireAuth(), (req, res) => {
 *   res.json({ user: await req.auth0.client.getUser() });
 * });
 *
 * // Protect an API route (returns 401 instead of redirecting)
 * app.get('/api/me', requireAuth(), async (req, res) => {
 *   const user = await req.auth0.client.getUser();
 *   res.json({ user });
 * });
 *
 * // Custom return URL after login
 * app.get('/admin', requireAuth({ returnTo: '/admin' }), (req, res) => {
 *   res.send('Admin page');
 * });
 * ```
 */
export function requireAuth(options?: RequireAuthOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await req.auth0.client.getUser();

      if (!user) {
        // Check if this is an API request (wants JSON response)
        const acceptsJson = req.accepts('json') && !req.accepts('html');

        if (acceptsJson) {
          return res.status(401).json({
            error: 'unauthorized',
            message: options?.errorMessage || 'Authentication required',
          });
        }

        // For HTML requests, redirect to login with returnTo
        const returnTo = options?.returnTo || req.originalUrl;
        const loginUrl = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
        return res.redirect(loginUrl);
      }

      // User is authenticated, continue
      next();
    } catch (error) {
      next(error);
    }
  };
}
