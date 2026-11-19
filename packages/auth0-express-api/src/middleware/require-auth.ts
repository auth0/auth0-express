import { Request, Response, NextFunction } from 'express';
import type { RequiresAuthOptions, Token } from '../types.js';
import { sendBearerError } from './claim-auth.js';

function validateScopes(token: Token, requiredScopes: string | string[]): boolean {
  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

  // Extract token scopes (handling different formats)
  let tokenScopes: string[] = [];

  if (token.scope) {
    tokenScopes = typeof token.scope === 'string' ? token.scope.split(' ') : token.scope;
  }

  // All required scopes must be present
  return scopes.every((required) => tokenScopes.includes(required));
}

function getToken(req: Request): string | undefined {
  const parts = req.headers.authorization?.split(' ');
  return parts?.length === 2 && parts[0]?.toLowerCase() === 'bearer' ? parts[1] : undefined;
}

/**
 * Middleware factory to require authentication on a route
 * @param options RequiresAuthOptions
 * @returns Express middleware function
 */
export function requiresAuth(options: RequiresAuthOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Express 4 ignores a rejected promise, so anything that throws while
    // answering goes to `next()` instead.
    try {
      const apiClient = req.auth0?.client;

      if (!apiClient) {
        return next(
          new Error('Auth0 ApiClient not found on request. Make sure the Auth0 Express API router is registered.')
        );
      }

      const accessToken = getToken(req);

      if (!accessToken) {
        return res.status(401).header('WWW-Authenticate', 'Bearer').end();
      }

      let token: Token;

      try {
        token = (await apiClient.verifyAccessToken({ accessToken })) as Token;
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((error as any).code === 'verify_access_token_error') {
          // The message can hold text from the request, such as the name of an unknown `crit` entry of the token.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return sendBearerError(res, 401, 'invalid_token', (error as any).message, undefined, { fromRequest: true });
        }

        return sendBearerError(res, 401, 'invalid_token', 'Invalid token');
      }

      if (options.scopes && !validateScopes(token, options.scopes)) {
        return sendBearerError(res, 403, 'insufficient_scope', 'Insufficient scopes');
      }

      req.auth0.user = token;
      // Non-enumerable, so logging or serialising `req.auth0` cannot leak it.
      Object.defineProperty(req.auth0, 'token', {
        value: accessToken,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      // Outside the verification `try`, so that an error thrown from here is not answered as a failed token. It goes to
      // the outer catch, and so to `next(error)`.
      next();
    } catch (error) {
      next(error);
    }
  };
}
