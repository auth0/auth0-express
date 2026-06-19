export interface RequiresAuthOptions {
  scopes?: string | string[];
}

export interface Token {
  sub: string;
  aud: string | string[];
  iss: string;
  scope?: string;

  [claim: string]: unknown;
}

export interface Auth0ApiOptions {
  /**
   * The auth0 domain (without https://).
   * Can be provided via AUTH0_DOMAIN environment variable.
   */
  domain?: string;
  /**
   * The audience for the API.
   * Can be provided via AUTH0_AUDIENCE environment variable.
   */
  audience?: string;
  /**
   * The optional client ID of the application.
   * Required when using the `getAccessTokenForConnection` method.
   */
  clientId?: string;
  /**
   * The optional client secret of the application.
   * At least one of `clientSecret` or `clientAssertionSigningKey` is required when using the `getAccessTokenForConnection` method.
   */
  clientSecret?: string;
  /**
   * The optional client assertion signing key to use.
   * At least one of `clientSecret` or `clientAssertionSigningKey` is required when using the `getAccessTokenForConnection` method.
   */
  clientAssertionSigningKey?: string | CryptoKey;
  /**
   * The optional client assertion signing algorithm to use with the `clientAssertionSigningKey`.
   * If not provided, it will default to `RS256`.
   */
  clientAssertionSigningAlg?: string;
  /**
   * Optional, custom Fetch implementation to use.
   */
  customFetch?: typeof fetch;
}
