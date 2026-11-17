import { InvalidPoppySessionError, PoppyError, SessionExpiredError } from '@auth0/auth0-server-js';

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
 * Three failures of a Poppy login get a status that tells the browser what went wrong, in place of `500`:
 *
 * - `PoppyError`: `403`, and the message of the error. The login is refused because of Poppy: a guest is in the browser
 *   and the login is not a signed-in agent's (`poppy_sign_in_required`), or the ID token looks like a guest's but is
 *   not valid (`invalid_poppy_guest`). The SDK gives each code a fixed text that holds no value, so it is safe to show.
 * - `InvalidPoppySessionError`: `400` and "The Poppy Session of this login is not valid."
 * - `SessionExpiredError`: `401` and "The session of this login has already ended."
 *
 * Any other error goes to `sanitizeHandlerError` and gets `500`. The login route never throws for `iss` or
 * `target_link_uri`: the SDK ignores a request that it cannot use and the login goes on as a normal login.
 */
export function sanitizePoppyHandlerError(cause: unknown): Error {
  if (cause instanceof PoppyError) {
    return errorWithStatus(cause.message, 403, cause);
  }
  if (cause instanceof InvalidPoppySessionError) {
    return errorWithStatus('The Poppy Session of this login is not valid.', 400, cause);
  }
  if (cause instanceof SessionExpiredError) {
    return errorWithStatus('The session of this login has already ended.', 401, cause);
  }
  return sanitizeHandlerError(cause);
}

function errorWithStatus(message: string, status: number, cause: unknown): Error {
  const error = new Error(message, { cause });
  (error as Error & { status?: number }).status = status;
  return error;
}
