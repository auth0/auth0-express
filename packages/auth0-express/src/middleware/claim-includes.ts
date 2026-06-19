import { Request, Response, NextFunction } from 'express';
import { ClaimAuthOptions } from './claim-auth.js';

/**
 * Middleware to check if a claim includes specific values.
 *
 * The claim may be an array, or a space-delimited string (such as a
 * scope-style `"read:users delete:users"` claim), which is split on spaces
 * before checking.
 *
 * Returns 403 Forbidden if the claim doesn't include all required values
 * or user is not authenticated.
 *
 * @param claim - The name of the claim to check
 * @param values - The values that must be present in the claim
 * @param options - Optional configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Require user to have specific permissions
 * app.delete('/users/:id', claimIncludes('permissions', ['delete:users']), (req, res) => {
 *   res.send('User deleted');
 * });
 *
 * // Require multiple permissions
 * app.post('/admin/users', claimIncludes('permissions', ['create:users', 'admin:access']), (req, res) => {
 *   res.send('User created');
 * });
 *
 * // Check roles
 * app.get('/dashboard', claimIncludes('roles', ['editor', 'admin']), (req, res) => {
 *   res.send('Dashboard');
 * });
 * ```
 */
export function claimIncludes(claim: string, values: unknown[], options?: ClaimAuthOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await req.auth0.client.getUser();

      if (!user) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      }

      const rawClaim = (user as Record<string, unknown>)[claim];

      // Accept both array claims and space-delimited string claims
      // (e.g. scope-style `"read:users delete:users"`).
      const claimValue =
        typeof rawClaim === 'string' ? rawClaim.split(' ') : rawClaim;

      if (!Array.isArray(claimValue)) {
        return res.status(options?.statusCode || 403).json({
          error: 'forbidden',
          message: options?.errorMessage || `Access denied`,
        });
      }

      const hasAllValues = values.every((value) => claimValue.includes(value));

      if (!hasAllValues) {
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
