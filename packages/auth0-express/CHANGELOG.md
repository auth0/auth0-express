# Change Log

## [v1.0.0](https://github.com/auth0/auth0-express/releases/tag/auth0-express-v1.0.0) (2026-10-08)

The `@auth0/auth0-express` library enables user authentication in Express applications.

The following features are included in v1.0.0:

- We mount the following 4 routes automatically for you to use:
  - `GET /auth/login`
  - `GET /auth/callback`
  - `GET /auth/logout`
  - `POST /auth/backchannel-logout`
- Routes are customizable via the `routes` configuration option, or can be disabled entirely with `mountRoutes: false`.
- The SDK uses stateless token storage by default, but supports stateful storage through the `sessionStore` configuration option.
- In stateless storage mode, the SDK will use cookie-chunking to store the token in the browser's cookies.
- Session secrets can be rotated without logging users out: pass an array to `sessionSecret`, where the first secret encrypts new cookies and all secrets are tried when decrypting.
- The SDK provides the following middleware for protecting routes and checking claims:
  - `requiresAuth()` requires authentication, redirecting to login for HTML requests or returning `401` for API requests.
  - `claimEquals(claim, value)` checks if a claim equals a specific value.
  - `claimIncludes(claim, ...values)` checks if an array claim contains the required values.
  - `claimCheck(fn)` runs your own authorization logic via a validation function.
- Configuration via environment variables (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SESSION_SECRET`, `APP_BASE_URL`, `AUTH0_AUDIENCE`) as an alternative to explicit options. The `express-openid-connect` names (`ISSUER_BASE_URL`, `CLIENT_ID`, `CLIENT_SECRET`, `BASE_URL`, `SECRET`) are also accepted to ease migration.
- Support for Pushed Authorization Requests (PAR) via the `pushedAuthorizationRequests` configuration option.
- Support for client assertion authentication via `clientAssertionSigningKey` and `clientAssertionSigningAlg` as an alternative to `clientSecret`.
- Dynamic application base URLs: omit `appBaseUrl` to infer it from each request, or pass an allow-list of permitted base URLs.
- Support for Multiple Custom Domains (MCD): pass a resolver function to `domain` to choose the Auth0 domain per request.
- Zero-downtime migration from `express-openid-connect`: set `legacyCompatibility` and existing cookie (stateless) and server-side store (stateful) sessions are read and upgraded, so users stay logged in.
- Enterprise Connect support via `enterpriseConnect` and the `onCallback` hook, to use Auth0 as a pure SSO relay while your app owns the session.
- Anonymous sessions via `anonymousSessions`, to give unauthenticated visitors a persistent identity before login.
- Experiment Center support (Early Access): pass `experiment_id` and `variation_id` on the login URL to force a variation.
- Custom `fetch` support via `customFetch`, and control over OIDC discovery caching via `discoveryCache`.
- The underlying `ServerClient` instance (from `@auth0/auth0-server-js`) is available as `req.auth0.client` for advanced use cases.
- Errors from the `login`, `callback` and `logout` routes are passed to your Express error handler with a generic message, so no internal detail is written to the response. See the `Error Handling` section of the README.
- The package is ESM-only (since `v1.0.0-beta.2`) and requires Node.js 22 LTS or a newer LTS version.

For more information on how to configure the SDK and use its features, please refer to the [README](https://github.com/auth0/auth0-express/blob/main/packages/auth0-express/README.md) or the [EXAMPLES](https://github.com/auth0/auth0-express/blob/main/packages/auth0-express/EXAMPLES.md). If you are moving from `express-openid-connect`, see the [MIGRATION](https://github.com/auth0/auth0-express/blob/main/packages/auth0-express/MIGRATION.md) guide.


## [v1.0.0-beta.5](https://github.com/auth0/auth0-express/tree/auth0-express-v1.0.0-beta.5) (2026-10-06)
[Full Changelog](https://github.com/auth0/auth0-express/compare/auth0-express-v1.0.0-beta.4...auth0-express-v1.0.0-beta.5)

**Added**
- feat(auth0-express): add anonymous sessions support [\#65](https://github.com/auth0/auth0-express/pull/65) ([@cschetan77](https://github.com/cschetan77))

**Fixed**
- fix(auth0-express): route stateless decrypt by cookie kid [\#59](https://github.com/auth0/auth0-express/pull/59) ([@nandan-bhat](https://github.com/nandan-bhat))
- fix(auth0-express): require a numeric header iat in the stateless legacy path [\#60](https://github.com/auth0/auth0-express/pull/60) ([@nandan-bhat](https://github.com/nandan-bhat))
- fix(auth0-express): exclude prototype-chain keys from custom-property passthrough [\#61](https://github.com/auth0/auth0-express/pull/61) ([@nandan-bhat](https://github.com/nandan-bhat))
- fix(auth0-express): validate that a migrated sid is a string [\#62](https://github.com/auth0/auth0-express/pull/62) ([@nandan-bhat](https://github.com/nandan-bhat))
- fix(auth0-express): HTML-escape interpolated values in the migration example [\#63](https://github.com/auth0/auth0-express/pull/63) ([@nandan-bhat](https://github.com/nandan-bhat))


## [v1.0.0-beta.4](https://github.com/auth0/auth0-express/tree/auth0-express-v1.0.0-beta.4) (2026-09-25)
[Full Changelog](https://github.com/auth0/auth0-express/compare/auth0-express-v1.0.0-beta.3...auth0-express-v1.0.0-beta.4)

**Added**
- feat(auth0-express): Experiment Center support [\#57](https://github.com/auth0/auth0-express/pull/57) ([@cschetan77](https://github.com/cschetan77))


## [v1.0.0-beta.3](https://github.com/auth0/auth0-express/tree/auth0-express-v1.0.0-beta.3) (2026-09-16)
[Full Changelog](https://github.com/auth0/auth0-express/compare/auth0-express-v1.0.0-beta.2...auth0-express-v1.0.0-beta.3)

**Added**
- feat(auth0-express): Enterprise Connect implementation [\#52](https://github.com/auth0/auth0-express/pull/52) ([@Piyush-85](https://github.com/Piyush-85))
- feat(auth0-express): migration stores for express-openid-connect migration [\#7](https://github.com/auth0/auth0-express/pull/7) ([@frederikprijck](https://github.com/frederikprijck))

**Fixed**
- fix(auth0-express): reject userinfo (@) in inferred base URL host [\#45](https://github.com/auth0/auth0-express/pull/45) ([@frederikprijck](https://github.com/frederikprijck))
- fix(auth0-express): keep migrated sessions alive across the absoluteDuration gap [\#46](https://github.com/auth0/auth0-express/pull/46) ([@frederikprijck](https://github.com/frederikprijck))
- fix(auth0-express): reserve OIDC Request-Object params in login handler [\#25](https://github.com/auth0/auth0-express/pull/25) ([@frederikprijck](https://github.com/frederikprijck))


## [v1.0.0-beta.2](https://github.com/auth0/auth0-express/releases/tag/auth0-express-v1.0.0-beta.2) (2026-08-04)
[Full Changelog](https://github.com/auth0/auth0-express/compare/auth0-express-v1.0.0-beta.1...auth0-express-v1.0.0-beta.2)

**Breaking Changes**
- chore: drop CJS build output, publish ESM-only [\#38](https://github.com/auth0/auth0-express/pull/38) ([frederikprijck](https://github.com/frederikprijck))

**Added**
- feat(auth0-express): support session secret rotation [\#36](https://github.com/auth0/auth0-express/pull/36) ([frederikprijck](https://github.com/frederikprijck))

**Security**
- fix(auth0-express): harden createRouteUrl against path injection attacks [\#23](https://github.com/auth0/auth0-express/pull/23) ([cschetan77](https://github.com/cschetan77))

## [v1.0.0-beta.1](https://github.com/auth0/auth0-express/releases/tag/auth0-express-v1.0.0-beta.1) (2026-06-19)
[Full Changelog](https://github.com/auth0/auth0-express/compare/auth0-express-v1.0.0-beta.0...auth0-express-v1.0.0-beta.1)

**Breaking Changes**
- feat(auth0-express): rename requireAuth to requiresAuth [\#8](https://github.com/auth0/auth0-express/pull/8) ([frederikprijck](https://github.com/frederikprijck))

**Added**
- feat(auth0-express): add dynamic application base URL support [\#4](https://github.com/auth0/auth0-express/pull/4) ([frederikprijck](https://github.com/frederikprijck))
- feat(auth0-express): add Multiple Custom Domains (MCD) support [\#6](https://github.com/auth0/auth0-express/pull/6) ([frederikprijck](https://github.com/frederikprijck))

**Fixed**
- fix(auth0-express): align claimIncludes and claimCheck with express-openid-connect [\#10](https://github.com/auth0/auth0-express/pull/10) ([frederikprijck](https://github.com/frederikprijck))

## [v1.0.0-beta.0](https://github.com/auth0/auth0-express/releases/tag/auth0-express-v1.0.0-beta.0) (2026-05-18)

The `@auth0/auth0-express` library allows for implementing user authentication in web applications on a JavaScript runtime.

In version 1.0.0-beta.0, we have added the following features:

- We mount the following 4 routes automatically for you to use:
  - `GET /auth/login`
  - `GET /auth/callback`
  - `GET /auth/logout`
  - `POST /auth/backchannel-logout`
- Routes are customizable via the `routes` configuration option, or can be disabled entirely with `mountRoutes: false`.
- The SDK uses a stateless token storage by default, but allows to opt-in to stateful storage if needed by providing a `sessionStore` configuration option.
- In stateless storage mode, the SDK will use cookie-chunking to store the token in the browser's cookies.
- The SDK provides the following middleware for protecting routes and checking claims:
  - `requiresAuth()` — requires authentication, redirecting to login for HTML requests or returning 401 for API requests.
  - `claimEquals(claim, value)` — checks if a claim equals a specific value.
  - `claimIncludes(claim, ...values)` — checks if an array claim contains the required values.
  - `claimCheck(fn)` — custom authorization logic via a validation function.
- Configuration via environment variables (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `AUTH0_APP_BASE_URL`, etc.) as an alternative to explicit options.
- Support for Pushed Authorization Requests (PAR) via the `pushedAuthorizationRequests` configuration option.
- Support for client assertion authentication via `clientAssertionSigningKey` and `clientAssertionSigningAlg` as an alternative to `clientSecret`.
- The entire underlying `ServerClient` instance (from `@auth0/auth0-server-js`) is exposed on `ExpressApplication` locals as `auth0Client` for advanced use-cases.

