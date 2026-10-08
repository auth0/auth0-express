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
