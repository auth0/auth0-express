import { Request, Response, NextFunction } from 'express';
import { ApiClient } from '@auth0/auth0-api-js';
import type { AuthRouteOptions, Token } from '../types.js';

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

function replyWithError(res: Response, statusCode: number, error: string, errorDescription: string): Response {
  return res
    .status(statusCode)
    .header(
      'WWW-Authenticate',
      `Bearer error="${error.replaceAll('"', '\\"')}", error_description="${errorDescription.replaceAll('"', '\\"')}"`
    )
    .json({
      error: error,
      error_description: errorDescription,
    });
}

function getToken(req: Request): string | undefined {
  const parts = req.headers.authorization?.split(' ');
  return parts?.length === 2 && parts[0]?.toLowerCase() === 'bearer' ? parts[1] : undefined;
}

/**
 * Middleware factory to require authentication on a route
 * @param options AuthRouteOptions
 * @returns Express middleware function
 */
export function requireAuth(options: AuthRouteOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const apiClient = req.auth0?.client;

    if (!apiClient) {
      throw new Error('Auth0 ApiClient not found on request. Make sure the Auth0 Express API router is registered.');
    }

    const accessToken = getToken(req);

    if (!accessToken) {
      return replyWithError(res, 400, 'invalid_request', 'No Authorization provided');
    }

    try {
      const token = (await apiClient.verifyAccessToken({ accessToken })) as Token;

      if (options.scopes && !validateScopes(token, options.scopes)) {
        return replyWithError(res, 403, 'insufficient_scope', 'Insufficient scopes');
      }

      req.auth0 = req.auth0 || {};
      req.auth0.user = token;
      next();
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any).code === 'verify_access_token_error') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return replyWithError(res, 401, 'invalid_token', (error as any).message);
      }

      return replyWithError(res, 401, 'invalid_token', 'Invalid token');
    }
  };
}
