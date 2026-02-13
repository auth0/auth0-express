import { Request, Response, NextFunction } from 'express';
import { ClaimAuthOptions } from './claim-auth.js';

/**
 * Middleware to check if a claim equals a specific value.
 *
 * Returns 403 Forbidden if the claim doesn't match or user is not authenticated.
 *
 * @param claim - The name of the claim to check
 * @param value - The expected value of the claim
 * @param options - Optional configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Require user to be an admin
 * app.get('/admin', claimEquals('role', 'admin'), (req, res) => {
 *   res.send('Admin dashboard');
 * });
 *
 * // Check organization membership
 * app.get('/org', claimEquals('org_id', 'org_123'), (req, res) => {
 *   res.send('Organization page');
 * });
 * ```
 */
export function claimEquals(claim: string, value: unknown, options?: ClaimAuthOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await req.auth0.client.getUser();

      if (!user) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      }

      const claimValue = (user as Record<string, unknown>)[claim];

      if (claimValue !== value) {
        return res.status(options?.statusCode || 403).json({
          error: 'forbidden',
          message: options?.errorMessage || `Access denied`,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}