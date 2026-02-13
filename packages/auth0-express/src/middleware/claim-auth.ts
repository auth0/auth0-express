/**
 * Type for a function that checks claims and returns true if authorized.
 */
export type ClaimCheckFunction = (claims: Record<string, unknown>) => boolean | Promise<boolean>;

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




