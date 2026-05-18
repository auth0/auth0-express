# Change Log

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
  - `requireAuth()` — requires authentication, redirecting to login for HTML requests or returning 401 for API requests.
  - `claimEquals(claim, value)` — checks if a claim equals a specific value.
  - `claimIncludes(claim, ...values)` — checks if an array claim contains the required values.
  - `claimCheck(fn)` — custom authorization logic via a validation function.
- Configuration via environment variables (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `AUTH0_APP_BASE_URL`, etc.) as an alternative to explicit options.
- Support for Pushed Authorization Requests (PAR) via the `pushedAuthorizationRequests` configuration option.
- Support for client assertion authentication via `clientAssertionSigningKey` and `clientAssertionSigningAlg` as an alternative to `clientSecret`.
- The entire underlying `ServerClient` instance (from `@auth0/auth0-server-js`) is exposed on `ExpressApplication` locals as `auth0Client` for advanced use-cases.

