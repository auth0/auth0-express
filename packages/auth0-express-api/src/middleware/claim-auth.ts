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
 * Sends an RFC 6750 style error response with a WWW-Authenticate header.
 *
 * @param res - Express response object
 * @param statusCode - HTTP status code (401 or 403)
 * @param error - OAuth error code
 * @param errorDescription - Human-readable error description
 * @param scopes - Optional array of required scopes (for insufficient_scope errors)
 * @param headerSafe - Whether to write the description into the header as a
 *   quoted-string of printable ASCII, for text that can come from the request
 * @returns Response object
 */
export function sendBearerError(
  res: Response,
  statusCode: number,
  error: string,
  errorDescription: string,
  scopes?: string[],
  headerSafe = false
): Response {
  const scopeHeader = scopes ? `, scope="${scopes.join(' ')}"` : '';
  // With `headerSafe` the text can come from the request, so it is cut down to
  // printable ASCII (anything else becomes `?`), and `\` and `"` are escaped so
  // that it stays inside the quoted-string.
  const headerDescription = headerSafe
    ? errorDescription.replace(/[^\x20-\x7e]/gu, '?').replace(/["\\]/g, '\\$&')
    : errorDescription.replaceAll('"', '\\"');
  return res
    .status(statusCode)
    .header(
      'WWW-Authenticate',
      `Bearer error="${error.replaceAll('"', '\\"')}", error_description="${headerDescription}"${scopeHeader}`
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
