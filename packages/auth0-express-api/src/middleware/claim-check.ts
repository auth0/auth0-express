import { Request, Response, NextFunction } from 'express';
import { ClaimAuthOptions, sendBearerError, ClaimCheckFunction } from './claim-auth.js';

/**
 * Middleware that validates token claims using a custom function.
 * Returns 401 invalid_token error if the function returns false.
 *
 * @param fn - Function that receives the token payload and returns true if valid
 * @param options - Optional configuration
 * @returns Express middleware function
 *
 * @example
 * ```ts
 * // Require admin with editor role
 * router.get('/admin/edit', requireAuth(), claimCheck(
 *   ({ isAdmin, roles }) => isAdmin && roles?.includes('editor'),
 *   { errorMessage: 'Requires admin with editor role' }
 * ), handler);
 *
 * // Legacy string support
 * router.get('/admin/edit', requireAuth(), claimCheck(
 *   ({ isAdmin, roles }) => isAdmin && roles?.includes('editor'),
 *   'Requires admin with editor role'
 * ), handler);
 * ```
 */
export function claimCheck(fn: ClaimCheckFunction, options?: ClaimAuthOptions) {
  if (typeof fn !== 'function') {
    throw new TypeError("'fn' must be a function");
  }

  const errorDescription = options?.errorMessage || 'Invalid token claims';

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.auth0?.user;

      if (!token) {
        return sendBearerError(res, 401, 'invalid_token', 'No token found');
      }

      try {
        const isValid = await fn(token);

        if (!isValid) {
          return sendBearerError(res, 401, 'invalid_token', errorDescription);
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (validationError) {
        return sendBearerError(res, 401, 'invalid_token', errorDescription);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
