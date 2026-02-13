import { Request, Response, NextFunction } from 'express';
import { ClaimAuthOptions, sendBearerError, JSONPrimitive } from './claim-auth.js';

/**
 * Middleware to check if a claim equals a specific value.
 *
 * Returns 401 invalid_token if the claim doesn't match or token is missing.
 *
 * @param claim - The name of the claim to check
 * @param value - The expected value of the claim
 * @param options - Optional configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Require user to be an admin
 * app.get('/admin', requireAuth(), claimEquals('role', 'admin'), (req, res) => {
 *   res.json({ message: 'Admin dashboard' });
 * });
 *
 * // Check organization membership with custom error
 * app.get('/org', requireAuth(), claimEquals('org_id', 'org_123', {
 *   errorMessage: 'You must be a member of org_123'
 * }), (req, res) => {
 *   res.json({ message: 'Organization page' });
 * });
 * ```
 */
export function claimEquals(claim: string, value: JSONPrimitive, options?: ClaimAuthOptions) {
  if (typeof claim !== 'string') {
    throw new TypeError("'claim' must be a string");
  }

  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    value !== null
  ) {
    throw new TypeError("'value' must be a string, number, boolean or null");
  }

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.auth0?.user;

      if (!token) {
        return sendBearerError(res, 401, 'invalid_token', 'No token found');
      }

      if (!(claim in token)) {
        return sendBearerError(res, 401, 'invalid_token', `Missing '${claim}' claim`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimValue = (token as any)[claim];

      if (claimValue !== value) {
        return sendBearerError(
          res,
          401,
          'invalid_token',
          options?.errorMessage || `Unexpected '${claim}' value`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
