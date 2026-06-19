import { Request, Response } from 'express';

/**
 * Type for a function that checks claims and returns true if authorized.
 *
 * @param req - The Express request, for authorization logic that depends on the
 *   request (e.g. route params, query, headers).
 * @param claims - The validated token claims.
 */
export type ClaimCheckFunction = (
  req: Request,
  claims: Record<string, unknown>
) => boolean | Promise<boolean>;

/**
 * Options for claim-based authorization middleware.
 */
export interface ClaimAuthOptions {
  /**
   * Custom error message to send when authorization fails.
   * This will be used as the error_description in the WWW-Authenticate header.
   */
  errorMessage?: string;
}

/**
 * Sends an RFC 6750 compliant error response with WWW-Authenticate header.
 *
 * @param res - Express response object
 * @param statusCode - HTTP status code (401 or 403)
 * @param error - OAuth error code
 * @param errorDescription - Human-readable error description
 * @param scopes - Optional array of required scopes (for insufficient_scope errors)
 * @returns Response object
 */
export function sendBearerError(
  res: Response,
  statusCode: number,
  error: string,
  errorDescription: string,
  scopes?: string[]
): Response {
  const scopeHeader = scopes ? `, scope="${scopes.join(' ')}"` : '';
  return res
    .status(statusCode)
    .header(
      'WWW-Authenticate',
      `Bearer error="${error.replaceAll('"', '\\"')}", error_description="${errorDescription.replaceAll('"', '\\"')}"${scopeHeader}`
    )
    .json({
      error: error,
      error_description: errorDescription,
    });
}

/**
 * Primitive JSON types that can be compared.
 */
export type JSONPrimitive = string | number | boolean | null;
