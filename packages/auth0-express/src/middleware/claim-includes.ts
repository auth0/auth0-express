import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to check if an array claim includes specific values.
 *
 * Returns 403 Forbidden if the claim doesn't include all required values
 * or user is not authenticated.
 *
 * @param claim - The name of the array claim to check
 * @param values - The values that must be present in the claim array
 * @param options - Optional configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Require user to have specific permissions
 * app.delete('/users/:id', claimIncludes('permissions', 'delete:users'), (req, res) => {
 *   res.send('User deleted');
 * });
 *
 * // Require multiple permissions
 * app.post('/admin/users', claimIncludes('permissions', 'create:users', 'admin:access'), (req, res) => {
 *   res.send('User created');
 * });
 *
 * // Check roles
 * app.get('/dashboard', claimIncludes('roles', 'editor', 'admin'), (req, res) => {
 *   res.send('Dashboard');
 * });
 * ```
 */
export function claimIncludes(claim: string, ...values: unknown[]) {
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

      if (!Array.isArray(claimValue)) {
        return res.status(403).json({
          error: 'forbidden',
          message: `Access denied`,
        });
      }

      const hasAllValues = values.every((value) => claimValue.includes(value));

      if (!hasAllValues) {
        return res.status(403).json({
          error: 'forbidden',
          message: `Access denied`,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
