# Change Log

## [v1.0.0](https://github.com/auth0/auth0-express/releases/tag/auth0-express-v1.0.0) (2026-02-10)

The `@auth0/auth0-express` library allows for implementing user authentication in web applications on a JavaScript runtime.

In version 1.0.0, we have added the following features:

- We mount the following 4 routes automatically for you to use:
  - `GET /auth/login`
  - `GET /auth/callback`
  - `GET /auth/logout`
  - `POST /auth/backchannel-logout`
- The SDK uses a stateless token storage by default, but allows to opt-in to stateful storage if needed by providing a `sessionStore` configuration option.
- In stateless storage mode, the SDK will use cookie-chunking to store the token in the browser's cookies.
- The entire underlying `ServerClient` instance (from `@auth0/auth0-server-js`) is exposed on `ExpressApplication` locals as `auth0Client` for advanced use-cases.

