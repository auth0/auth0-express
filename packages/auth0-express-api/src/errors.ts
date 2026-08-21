/**
 * The shape of an error thrown by `ApiClient.getAccessTokenForConnection()`.
 *
 * A type rather than a class, because the class it describes,
 * `TokenForConnectionError`, is not exported by `@auth0/auth0-api-js`. Narrow
 * with {@link isConnectionExchangeError} instead of `instanceof`.
 */
export type ConnectionExchangeError = Error & {
  /**
   * Stable identifier for the failure. Compare this, not the message. The set of
   * codes this guard matches stays private so widening it is not a breaking
   * change, but `code` itself is here, so read it when you need to know which
   * one you got.
   */
  code: string;
  /**
   * What the tenant said, when the tenant is what refused. Absent when the SDK
   * failed before reaching Auth0, for example with no client credentials
   * configured.
   */
  cause?: {
    error?: string;
    error_description?: string;
  };
};

// One place that knows the code, so widening it later does not ask every
// consumer to change their catch block.
//
// `@auth0/auth0-auth-js` has deprecated `TokenForConnectionError` as of v1.2.0
// and plans to remove it in v2.0, in favour of `TokenExchangeError` and its
// `token_exchange_error` code. When api-js follows, that code joins this list.
const CONNECTION_EXCHANGE_ERROR_CODES = ['token_for_connection_error'];

/**
 * Narrows a caught value to a Token Vault exchange failure.
 *
 * `getAccessTokenForConnection()` throws `TokenForConnectionError`, which
 * `@auth0/auth0-api-js` does not export, so there is no class to catch. This
 * checks `error.code` for you and keeps that comparison in one place.
 *
 * Returns `false` for `MissingClientAuthError`, which the same call throws when
 * `clientId` is configured without a `clientSecret` or
 * `clientAssertionSigningKey`. That one is your own misconfiguration rather than
 * a failed exchange, and it can be caught by class.
 *
 * @param error - The caught value, which is `unknown` under `strict`
 * @returns Whether the value is a Token Vault exchange failure
 *
 * @example
 * ```ts
 * try {
 *   const { accessToken } = await req.auth0.client.getAccessTokenForConnection({
 *     connection: 'google-oauth2',
 *     accessToken: req.auth0.token!,
 *   });
 * } catch (error) {
 *   if (error instanceof MissingClientAuthError) {
 *     // This API cannot authenticate to the token endpoint. A 500, not a 502.
 *   } else if (isConnectionExchangeError(error)) {
 *     // `cause` present means the tenant refused, e.g. the user never linked
 *     // the connection. Absent means the SDK never got there.
 *     console.error(error.code, error.cause?.error_description ?? error.message);
 *   }
 * }
 * ```
 */
export function isConnectionExchangeError(error: unknown): error is ConnectionExchangeError {
  return (
    error instanceof Error &&
    typeof (error as ConnectionExchangeError).code === 'string' &&
    CONNECTION_EXCHANGE_ERROR_CODES.includes((error as ConnectionExchangeError).code)
  );
}
