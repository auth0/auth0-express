import { AsyncLocalStorage } from 'node:async_hooks';
import { StoreOptions } from 'src/types.js';

/**
 * Context containing Express request and response objects.
 * Available within the AsyncLocalStorage scope established by the auth0 middleware.
 */
export type RequestContext = StoreOptions;

/**
 * AsyncLocalStorage instance for storing request context.
 * @internal
 */
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs a callback within an AsyncLocalStorage context containing the request and response.
 * This establishes the context for the entire request lifecycle.
 *
 * @param request - Express request object
 * @param response - Express response object
 * @param callback - Function to execute within the context
 * @returns The result of the callback
 *
 * @example
 * ```typescript
 * app.use((req, res, next) => {
 *   runWithContext(req, res, () => next());
 * });
 * ```
 */
export function runWithContext<T>(
  context: RequestContext,
  callback: () => T
): T {
  return asyncLocalStorage.run(context, callback);
}

/**
 * Retrieves the current request context from AsyncLocalStorage.
 *
 * @returns The current RequestContext
 * @throws {Error} If called outside of a request context
 *
 * @example
 * ```typescript
 * const { request, response } = getRequestContext();
 * ```
 */
export function getRequestContext(): RequestContext {
  const context = asyncLocalStorage.getStore();

  if (!context) {
    throw new Error(
      'Request context not available. This error typically occurs when:\n' +
        '1. Client methods are called outside of a request handler\n' +
        '2. The auth0 middleware has not been initialized\n' +
        '3. AsyncLocalStorage context was lost in an async operation\n\n' +
        'Ensure you are calling client methods within an Express request handler ' +
        'and the auth0 middleware is properly configured.'
    );
  }

  return context;
}
