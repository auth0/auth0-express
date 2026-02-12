import { Request, Response, NextFunction } from 'express';
import { ClaimAuthOptions, sendBearerError, JSONPrimitive } from './claim-auth.js';

/**
 * Middleware that checks if a claim includes all of the specified values.
 * Works with both array claims and space-separated string claims.
 * Returns 401 invalid_token error if not all values are included.
 *
 * @param claim - The name of the claim to check
 * @param expected - The values that should be included in the claim
 * @param options - Optional configuration
 * @returns Express middleware function
 *
 * @example
 * ```ts
 * // Require both 'admin' and 'manager' roles
 * router.get('/admin/managers', requireAuth(), claimIncludes('role', ['admin', 'manager']), handler);
 *
 * // Custom error message
 * router.get('/admin/managers', requireAuth(), claimIncludes('role', ['admin', 'manager'], {
 *   errorMessage: 'You must have both admin and manager roles'
 * }), handler);
 * ```
 */
export function claimIncludes(claim: string, expected: JSONPrimitive[], options?: ClaimAuthOptions) {
  if (typeof claim !== 'string') {
    throw new TypeError("'claim' must be a string");
  }

  expected.forEach((value) => {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      value !== null
    ) {
      throw new TypeError("'expected' values must be strings, numbers, booleans or null");
    }
  });

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
      let actual: any = (token as any)[claim];

      // Handle space-separated strings (like scopes)
      if (typeof actual === 'string') {
        actual = actual.split(' ');
      } else if (!Array.isArray(actual)) {
        return sendBearerError(
          res,
          401,
          'invalid_token',
          options?.errorMessage || `Unexpected '${claim}' value`
        );
      }

      // Convert to Set for efficient lookup
      const actualSet = new Set(actual as JSONPrimitive[]);

      // Check if all expected values are included
      const allIncluded = expected.every((value) => actualSet.has(value));

      if (!allIncluded) {
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
