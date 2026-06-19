import type { Request } from 'express';

/**
 * Type for a function that checks claims and returns true if authorized.
 *
 * @param req - The Express request, for authorization logic that depends on the
 *   request (e.g. route params, query, headers).
 * @param claims - The authenticated user's claims.
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
   */
  errorMessage?: string;

  /**
   * Custom status code to return when authorization fails.
   * Default: 403 (Forbidden)
   */
  statusCode?: number;
}

/**
 * Primitive JSON types that can be compared.
 */
export type JSONPrimitive = string | number | boolean | null;

