# Change Log

## [v1.0.0-beta.3](https://github.com/auth0/auth0-express/tree/auth0-express-api-v1.0.0-beta.3) (2026-08-21)
[Full Changelog](https://github.com/auth0/auth0-express/compare/auth0-express-api-v1.0.0-beta.2...auth0-express-api-v1.0.0-beta.3)

**Added**
- feat(auth0-express-api): support Custom Token Exchange via getTokenByExchangeProfile [\#42](https://github.com/auth0/auth0-express/pull/42) ([@nandan-bhat](https://github.com/nandan-bhat))
- feat(auth0-express-api): support Token Vault via getAccessTokenForConnection [\#41](https://github.com/auth0/auth0-express/pull/41) ([@nandan-bhat](https://github.com/nandan-bhat))
- feat(auth0-express-api): add support for on-behalf-of token exchange [\#40](https://github.com/auth0/auth0-express/pull/40) ([@nandan-bhat](https://github.com/nandan-bhat))

**Fixed**
- fix(auth0-express-api): default scopesInclude match to 'all' [\#24](https://github.com/auth0/auth0-express/pull/24) ([@frederikprijck](https://github.com/frederikprijck))


## [v1.0.0-beta.2](https://github.com/auth0/auth0-express/releases/tag/auth0-express-api-v1.0.0-beta.2) (2026-06-22)
[Full Changelog](https://github.com/auth0/auth0-express/compare/auth0-express-api-v1.0.0-beta.1...auth0-express-api-v1.0.0-beta.2)

**Fixed**
- fix(auth0-express-api): return 401 instead of 400 when no token is provided [\#18](https://github.com/auth0/auth0-express/pull/18) ([frederikprijck](https://github.com/frederikprijck))

## [v1.0.0-beta.1](https://github.com/auth0/auth0-express/releases/tag/auth0-express-api-v1.0.0-beta.1) (2026-06-19)
[Full Changelog](https://github.com/auth0/auth0-express/compare/auth0-express-api-v1.0.0-beta.0...auth0-express-api-v1.0.0-beta.1)

**Breaking Changes**
- feat(auth0-express-api): rename requireAuth to requiresAuth [\#9](https://github.com/auth0/auth0-express/pull/9) ([frederikprijck](https://github.com/frederikprijck))

**Fixed**
- fix(auth0-express): align claimIncludes and claimCheck with express-openid-connect [\#10](https://github.com/auth0/auth0-express/pull/10) ([frederikprijck](https://github.com/frederikprijck))

## [v1.0.0-beta.0](https://github.com/auth0/auth0-express/releases/tag/auth0-express-api-v1.0.0-beta.0) (2026-05-18)

The `@auth0/auth0-express-api` library allows for protecting API endpoints in Express applications on a JavaScript runtime.

In version 1.0.0-beta.0, we have added the following features:

- Access Token validation from the `Authorization` header (Bearer scheme) via `requiresAuth()` middleware, with optional scope validation.
- The SDK provides the following middleware for claim-based authorization:
  - `claimEquals(claim, value)` — checks if a claim equals a specific value.
  - `claimIncludes(claim, ...values)` — checks if a claim contains all specified values (supports array and space-separated string claims).
  - `claimCheck(fn)` — custom authorization logic via a validation function.
  - `scopesInclude(scopes, options?)` — validates token scopes with `'any'` or `'all'` matching strategies.
- RFC 6750 compliant Bearer error responses with proper `WWW-Authenticate` headers.
- Configuration via environment variables (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_CLIENT_ASSERTION_SIGNING_KEY`) with support for `ISSUER_BASE_URL` and `AUDIENCE` aliases.
- Support for client assertion authentication via `clientAssertionSigningKey` and `clientAssertionSigningAlg` as an alternative to `clientSecret`.
- The verified token payload is available on `req.auth0.user` and the API client on `req.auth0.client`.
