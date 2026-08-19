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
 * Only what this package's own surface already exposes, so that consumers can
 * name those types without installing and pinning `@auth0/auth0-api-js`
 * themselves. Anything api-js can do that this package does not is left out on
 * purpose, including DPoP, Multi Custom Domains, Protected Resource Metadata,
 * the discovery cache and sessions, and is added by the change that implements
 * it rather than ahead of time.
 *
 * Also left out is `getToken()`, which extracts a token from a request before it
 * has been verified. Use `req.auth0.token` instead, which is only set once
 * `requiresAuth()` has verified it.
 */

/**
 * Type only, on purpose. `req.auth0.client` is an `ApiClient`, so the type is
 * already part of this package's published surface and consumers need the name
 * to annotate it. The class itself stays unexported so the only way to get a
 * client is `createAuth0Api()`. Exporting the constructor would let an app build
 * a second client with different credentials, skipping this package's
 * configuration and environment variable handling.
 */
export type { ApiClient } from '@auth0/auth0-api-js';

// RFC 8693 actor claim helpers. Both accept `req.auth0.user` directly.
export { getCurrentActor, getDelegationChain } from '@auth0/auth0-api-js';

// The errors reachable through this package's surface, exported as values so
// `instanceof` works. `VerifyAccessTokenError` comes from `requiresAuth()`.
// `MissingClientAuthError` and `TokenExchangeError` come from calling Auth0 as a
// client through `req.auth0.client`. `InvalidRequestError` comes from the actor
// claim helpers above, on a malformed `act` claim.
//
// These are two hierarchies, not one. `VerifyAccessTokenError` and
// `InvalidRequestError` extend `AuthError`, whose `cause` is an
// `AuthErrorCause`. `MissingClientAuthError` and `TokenExchangeError` come from
// `@auth0/auth0-auth-js` and do not extend `AuthError`, so an
// `instanceof AuthError` check will not catch them, and their `cause` carries
// the tenant's `error` and `error_description` instead. Checking `error.code` is
// the sturdier option either way, since `instanceof` also fails if an app ends
// up with a second copy of api-js that npm could not deduplicate.
export {
  AuthError,
  InvalidRequestError,
  MissingClientAuthError,
  TokenExchangeError,
  VerifyAccessTokenError,
} from '@auth0/auth0-api-js';

export type { ActClaim, AuthErrorCause, OnBehalfOfTokenOptions, OnBehalfOfTokenResult } from '@auth0/auth0-api-js';