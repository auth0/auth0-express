export { createAuth0Api } from './router.js';
export type { Auth0ApiOptions, RequiresAuthOptions, Token } from './types.js';

export { requiresAuth } from './middleware/require-auth.js';
export { claimEquals } from './middleware/claim-equals.js';
export { claimIncludes } from './middleware/claim-includes.js';
export { claimCheck } from './middleware/claim-check.js';
export { scopesInclude } from './middleware/scopes-include.js';
export type { ScopesIncludeOptions } from './middleware/scopes-include.js';
export type { ClaimAuthOptions, ClaimCheckFunction, JSONPrimitive } from './middleware/claim-auth.js';

// Re-exports from `@auth0/auth0-api-js`, limited to what this package's own
// surface exposes. `exports.spec.ts` pins the list.

// Type only, so `createAuth0Api()` stays the only way to get a client.
export type { ApiClient } from '@auth0/auth0-api-js';

// RFC 8693 actor claim helpers. Both accept `req.auth0.user` directly.
export { getCurrentActor, getDelegationChain } from '@auth0/auth0-api-js';

// The errors reachable through this package's surface, as values so `instanceof`
// works. Two hierarchies: only `InvalidRequestError` and `VerifyAccessTokenError`
// extend `AuthError`. `error.code` is the sturdier check either way.
//
// `getAccessTokenForConnection()` throws `TokenForConnectionError`, which api-js
// does not export, so it is absent here and `error.code` is the only check for
// it. EXAMPLES.md documents that.
export {
  AuthError,
  InvalidRequestError,
  MissingClientAuthError,
  TokenExchangeError,
  VerifyAccessTokenError,
} from '@auth0/auth0-api-js';

export type { ActClaim } from '@auth0/auth0-api-js';

// Options and results for the `ApiClient` exchange methods, so a consumer can
// annotate a function that wraps one.
export type {
  AccessTokenForConnectionOptions,
  ConnectionTokenSet,
  OnBehalfOfTokenOptions,
  OnBehalfOfTokenResult,
} from '@auth0/auth0-api-js';
