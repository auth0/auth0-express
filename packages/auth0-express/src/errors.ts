import { PoppyError, SessionExpiredError, type IssuerValidationError } from '@auth0/auth0-server-js';

/**
 * Normalizes an error thrown by a browser-facing auth handler (login, callback,
 * logout) into a sanitized error before it is handed to Express via `next()`.
 *
 * This solves two problems at once:
 *
 * 1. No internal detail leaks to the client. The browser-facing handlers
 *    delegate to Express's error pipeline, and Express's default handler
 *    (finalhandler) writes `err.stack` into the response body whenever the app
 *    is not running with `NODE_ENV=production`. By replacing the original error
 *    with one that carries only a generic message, that body can never contain
 *    an OAuth `error_description`, a token-endpoint failure reason, or any other
 *    internal detail, regardless of `NODE_ENV`. The original error is preserved
 *    on `cause` (which finalhandler never serializes into the body) so an
 *    application's own error-handling middleware can still log it server-side.
 *
 * 2. The client-facing status stays stable. finalhandler derives the HTTP
 *    status from `err.status`/`err.statusCode`. The underlying client attaches
 *    the upstream HTTP status to some failures, so a failed code exchange would
 *    otherwise surface to the browser as the token endpoint's `400` rather than
 *    a `500`. Pinning the status to `500` keeps the callback/login/logout
 *    failure contract independent of whatever status an upstream call returned.
 */
export function sanitizeHandlerError(cause: unknown): Error {
  const error = new Error('Authentication request could not be completed.', { cause });
  (error as Error & { status?: number }).status = 500;
  return error;
}

/**
 * The same as `sanitizeHandlerError`, for an app that has the `poppy` option. The error handed to `next()` carries a
 * fixed text and no detail, whatever `NODE_ENV` is, and the original error stays on `cause`.
 *
 * Two failures of a Poppy login get a status that tells the browser what went wrong, in place of `500`. Both are `403`,
 * and the error has the `code` of the cause, a fixed string, so an app can tell them apart with `error.code`:
 *
 * - `PoppyError`: the message of the error. The login is refused because of Poppy: a guest is in the browser and the
 *   login is not a signed-in agent's (`poppy_sign_in_required`), the ID token looks like a guest's but is not valid
 *   (`invalid_poppy_guest`), or its Poppy Session is not well formed (`invalid_poppy_agent`). The SDK gives each code a
 *   fixed text that holds no value, so it is safe to show.
 * - `SessionExpiredError`: "The session of this login has already ended." (`session_expired`)
 *
 * Any other error goes to `sanitizeHandlerError` and gets `500` and no `code`. A login request with an `iss` that is not
 * the issuer is refused by the login handler with `refusedIssuerError`, and this function does not map that error.
 */
export function sanitizePoppyHandlerError(cause: unknown): Error {
  if (cause instanceof PoppyError) {
    return errorWithStatus(cause.message, 403, cause, cause.code);
  }
  if (cause instanceof SessionExpiredError) {
    return errorWithStatus('The session of this login has already ended.', 403, cause, cause.code);
  }
  return sanitizeHandlerError(cause);
}

function errorWithStatus(message: string, status: number, cause: unknown, code: string): Error {
  return Object.assign(new Error(message, { cause }), { status, code });
}

/**
 * The error for a login request whose `iss` is empty, repeated or not the issuer of the config. The request says that
 * it comes from another issuer, so the SDK refuses it and the login does not start. The error is a `400` with the `code`
 * of the cause, `issuer_validation_error`, and the original error stays on `cause`.
 *
 * The text is fixed here, and holds no value from the request: anyone can put any `iss` in the query, and Express's
 * default error handler writes the text into the page.
 */
export function refusedIssuerError(cause: IssuerValidationError): Error {
  return errorWithStatus(
    'Invalid iss query parameter: it is not the Auth0 issuer this app uses.',
    400,
    cause,
    cause.code
  );
}
