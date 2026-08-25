export { InvalidConfigurationError } from '@auth0/auth0-server-js';

export class MissingStoreOptionsError extends Error {
  public code: string = 'missing_store_options_error';

  constructor(message?: string) {
    super(message ?? 'The store options are missing, making it impossible to interact with the store.');
    this.name = 'MissingStoreOptionsError';
  }
}

/**
 * An error that carries the HTTP `status` a request handler should respond with,
 * for forwarding to Express via `next(error)`.
 *
 * Express's default error handler reads `err.status` (falling back to 500 if it
 * is outside the 4xx/5xx range) to set the response code, so forwarding this
 * produces the intended status even without a custom error handler — while the
 * default handler omits `err.message` from the client response in production.
 *
 * The originating failure is preserved on `cause` (typed as `TError`) so
 * application error middleware can log it or branch on it. Caught values are
 * `unknown` under strict TypeScript, so `TError` defaults to `unknown`; narrow
 * `cause` at the point of use.
 *
 * @typeParam TError - The type of the wrapped `cause`.
 */
export class GenericRequestError<TError = unknown> extends Error {
  public readonly status: number;
  public declare readonly cause?: TError;

  constructor(status: number, message: string, options?: { cause?: TError }) {
    super(message, options);
    this.name = 'GenericRequestError';
    this.status = status;
  }
}
