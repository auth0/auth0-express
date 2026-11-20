import { Request, Response } from 'express';
import { isPoppyClient } from '../poppy/poppy-clients.js';
import { dpopChallenge } from '../poppy/challenges.js';

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
   *
   * The JSON body carries the message as it is. In the header, `"` and `\` are escaped, and a character that Node
   * refuses in a header value (anything above U+00FF, or a control character other than a tab) is written as `?`.
   */
  errorMessage?: string;
}

/**
 * Options of {@link sendBearerError}.
 */
export interface BearerErrorOptions {
  /**
   * Set it when the description holds text that can come from the request, such as the message of a failed token
   * verification. In the header, the text is then cut down to printable ASCII (anything else becomes `?`) and to 256
   * characters. The JSON body is not changed.
   */
  fromRequest?: boolean;
  /**
   * Whether to send the `DPoP` challenge too. A router with the `poppy` option accepts `DPoP` access tokens as well as
   * `Bearer` ones, so its errors name both. By default it is `true` when the request went through such a router, which
   * `res.req` tells, and `false` otherwise, as a router without `poppy` accepts `Bearer` only.
   */
  dpop?: boolean;
}

/** The most characters of text from the request that the header carries. */
const MAX_REQUEST_TEXT_IN_HEADER = 256;

/**
 * The text as the inside of a quoted-string for the header (RFC 9110, section 5.6.4). Every character that Node
 * refuses in a header value becomes `?`, and `\` and `"` get a backslash. The cut comes before the escaping, so that it
 * never leaves a backslash on its own.
 */
function quotedStringText(text: string, fromRequest: boolean): string {
  const safe = fromRequest
    ? text.replace(/[^\x20-\x7e]/gu, '?').slice(0, MAX_REQUEST_TEXT_IN_HEADER)
    : text.replace(/[^\t\x20-\x7e\x80-\xff]/gu, '?');

  return safe.replace(/["\\]/g, '\\$&');
}

/**
 * Sends an RFC 6750 style error response with a WWW-Authenticate header.
 *
 * @param res - Express response object
 * @param statusCode - HTTP status code (401 or 403)
 * @param error - OAuth error code
 * @param errorDescription - Human-readable error description
 * @param scopes - Optional array of required scopes (for insufficient_scope errors)
 * @param options - See {@link BearerErrorOptions}
 * @returns Response object
 */
export function sendBearerError(
  res: Response,
  statusCode: number,
  error: string,
  errorDescription: string,
  scopes?: string[],
  options: BearerErrorOptions = {}
): Response {
  // The scopes are set by the developer, and they are text in the header like the description: escaped, and a `?` for a
  // character that Node refuses.
  const scopeHeader = scopes ? `, scope="${quotedStringText(scopes.join(' '), false)}"` : '';
  const headerDescription = quotedStringText(errorDescription, options.fromRequest === true);
  const bearer = `Bearer error="${error.replaceAll('"', '\\"')}", error_description="${headerDescription}"${scopeHeader}`;
  const dpop = options.dpop ?? isPoppyClient(res.req?.auth0?.client);

  return res
    .status(statusCode)
    .header('WWW-Authenticate', dpop ? [bearer, dpopChallenge({ error, errorDescription, scopes })] : bearer)
    .json({
      error: error,
      error_description: errorDescription,
    });
}

/**
 * Primitive JSON types that can be compared.
 */
export type JSONPrimitive = string | number | boolean | null;
