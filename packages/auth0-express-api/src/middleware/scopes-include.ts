import { Request, Response, NextFunction } from 'express';
import { sendBearerError } from './claim-auth.js';

export interface ScopesIncludeOptions {
  /**
   * Match strategy:
   * - 'any': Token must have at least one of the specified scopes (default)
   * - 'all': Token must have all of the specified scopes
   */
  match?: 'any' | 'all';
}

/**
 * Middleware that checks if the token has the specified scopes.
 * Returns 403 insufficient_scope error if the scope requirements are not met.
 *
 * @param scopes - Space-separated string or array of scopes
 * @param options - Configuration options
 * @param options.match - Match strategy: 'any' (default) or 'all'
 * @returns Express middleware function
 *
 * @example
 * ```ts
 * // Allow access if token has ANY of the specified scopes (default)
 * router.get('/messages', requireAuth(), scopesInclude('read:msg read:admin'), handler);
 *
 * // Require ALL of the specified scopes
 * router.get('/admin/edit', requireAuth(), scopesInclude('read:admin write:admin', { match: 'all' }), handler);
 * ```
 */
export function scopesInclude(scopes: string | string[], options: ScopesIncludeOptions = {}) {
  const { match = 'any' } = options;
  let requiredScopes: string[];

  if (typeof scopes === 'string') {
    requiredScopes = scopes.split(' ').filter((s) => s.length > 0);
  } else if (Array.isArray(scopes)) {
    requiredScopes = scopes;
  } else {
    throw new TypeError("'scopes' must be a string or array of strings");
  }

  if (requiredScopes.length === 0) {
    throw new Error("'scopes' must contain at least one scope");
  }

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.auth0?.user;

      if (!token) {
        return sendBearerError(res, 403, 'insufficient_scope', 'Insufficient scopes', requiredScopes);
      }

      if (!token.scope) {
        return sendBearerError(res, 403, 'insufficient_scope', 'Insufficient scopes', requiredScopes);
      }

      // Parse token scopes
      const tokenScopes = typeof token.scope === 'string' ? token.scope.split(' ') : token.scope;
      const tokenScopeSet = new Set(tokenScopes);

      // Check based on match strategy
      const hasRequiredScopes =
        match === 'all'
          ? requiredScopes.every((scope) => tokenScopeSet.has(scope))
          : requiredScopes.some((scope) => tokenScopeSet.has(scope));

      if (!hasRequiredScopes) {
        return sendBearerError(res, 403, 'insufficient_scope', 'Insufficient scopes', requiredScopes);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
