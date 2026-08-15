export { createAuth0Api } from './router.js';
export type { Auth0ApiOptions, RequiresAuthOptions, Token } from './types.js';

export { requiresAuth } from './middleware/require-auth.js';
export { claimEquals } from './middleware/claim-equals.js';
export { claimIncludes } from './middleware/claim-includes.js';
export { claimCheck } from './middleware/claim-check.js';
export { scopesInclude } from './middleware/scopes-include.js';
export type { ScopesIncludeOptions } from './middleware/scopes-include.js';
export type { ClaimAuthOptions, ClaimCheckFunction, JSONPrimitive } from './middleware/claim-auth.js';

/**
 * Re-exports from `@auth0/auth0-api-js`.
 *
 * `req.auth0.client` is an `ApiClient`, so its whole method surface is already
 * reachable from an Express app. These re-exports make that surface typed
 * without asking consumers to install and pin `@auth0/auth0-api-js` themselves.
 *
 * Symbols for features this package does not support are deliberately left out:
 * DPoP, Multi Custom Domains, Protected Resource Metadata, the discovery cache,
 * and sessions. Also left out is `getToken()`, which extracts a token from a
 * request before it has been verified. Use `req.auth0.token` instead, which is
 * only set once `requiresAuth()` has verified it.
 */
export { ApiClient } from '@auth0/auth0-api-js';

// RFC 8693 actor claim helpers. Both accept `req.auth0.user` directly.
export { getCurrentActor, getDelegationChain } from '@auth0/auth0-api-js';

export {
  AuthError,
  InvalidConfigurationError,
  InvalidRequestError,
  MissingClientAuthError,
  MissingRequiredArgumentError,
  TokenExchangeError,
  VerifyAccessTokenError,
} from '@auth0/auth0-api-js';

export type {
  AccessTokenForConnectionOptions,
  ActClaim,
  AuthErrorCause,
  ConnectionTokenSet,
  ExchangeProfileOptions,
  OnBehalfOfTokenOptions,
  OnBehalfOfTokenResult,
  TokenExchangeProfileResult,
  VerifiedAccessTokenClaims,
} from '@auth0/auth0-api-js';