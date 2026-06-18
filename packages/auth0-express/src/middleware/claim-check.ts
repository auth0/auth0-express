import { Request, Response, NextFunction } from 'express';
import { ClaimAuthOptions, ClaimCheckFunction } from './claim-auth.js';

/**
 * Middleware to check claims using a custom validation function.
 *
 * Returns 403 Forbidden if the validation function returns false
 * or user is not authenticated.
 *
 * @param checkFn - A function that receives the user claims and the Express
 *   request and returns true if authorized
 * @param options - Optional configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Custom claim validation
 * app.get('/premium', claimCheck((claims) => {
 *   return claims.subscription === 'premium' && !claims.subscription_expired;
 * }), (req, res) => {
 *   res.send('Premium content');
 * });
 *
 * // Complex authorization logic using the request
 * app.delete('/posts/:id', claimCheck(async (claims, req) => {
 *   const post = await getPost(req.params.id);
 *   return claims.sub === post.authorId || claims.role === 'admin';
 * }), (req, res) => {
 *   res.send('Post deleted');
 * });
 *
 * // With custom error message
 * app.get('/beta', claimCheck(
 *   (claims) => claims.beta_access === true,
 *   { errorMessage: 'Beta access required' }
 * ), (req, res) => {
 *   res.send('Beta features');
 * });
 * ```
 */
export function claimCheck(checkFn: ClaimCheckFunction, options?: ClaimAuthOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await req.auth0.client.getUser();

      if (!user) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      }

      const isAuthorized = await checkFn(user as Record<string, unknown>, req);

      if (!isAuthorized) {
        return res.status(options?.statusCode || 403).json({
          error: 'forbidden',
          message: options?.errorMessage || 'Access denied',
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}