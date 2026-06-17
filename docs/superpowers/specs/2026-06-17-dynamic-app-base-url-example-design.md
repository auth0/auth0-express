# Design: Dynamic App Base URL Example App

**Date:** 2026-06-17  
**Feature:** Allow-list mode for `appBaseUrl` in `@auth0/auth0-express`

## Overview

A new standalone example app (`examples/example-express-dynamic-app-base-url`) that demonstrates the allow-list mode of the dynamic `appBaseUrl` feature. A single Express app serves two distinct domains (`app1.localhost` and `app2.localhost`) on port 3000 using the same Auth0 application. The SDK validates each request's origin against the allow-list and uses the correct base URL for callbacks, redirects, and logout.

## Structure

```
examples/example-express-dynamic-app-base-url/
  src/index.ts          # Express app with allow-list appBaseUrl
  views/                # EJS templates (index, public, private — same as example-express-web)
  public/               # Static assets
  .env.example          # APP_BASE_URL as a JSON array of the two alias URLs
  package.json
  tsconfig.json
  README.md             # Includes /etc/hosts setup instructions
```

## Configuration

### `appBaseUrl`

Set as a JSON array in the `APP_BASE_URL` environment variable:

```
APP_BASE_URL=["http://app1.localhost:3000","http://app2.localhost:3000"]
```

The SDK's `getConfig()` already handles parsing a JSON-array env var value into `string[]`.

### `/etc/hosts` entries (user adds these)

```
127.0.0.1  app1.localhost
127.0.0.1  app2.localhost
```

### Auth0 tenant setup

Both callback and logout URLs must be added to the Auth0 application's allowed lists:

- **Allowed Callback URLs:** `http://app1.localhost:3000/auth/callback, http://app2.localhost:3000/auth/callback`
- **Allowed Logout URLs:** `http://app1.localhost:3000, http://app2.localhost:3000`
- **Allowed Web Origins:** `http://app1.localhost:3000, http://app2.localhost:3000`

## App Code

The Express app is structured identically to `example-express-web`, with one key difference in the `createAuth0()` call: `appBaseUrl` is omitted (or left to be parsed from `APP_BASE_URL` as an array) rather than passed as a single string.

The app has three routes:

- `GET /` — home page, shows login/logout link and current user if authenticated
- `GET /public` — public route, accessible without auth, shows current user if any
- `GET /private` — protected route, requires session; redirects to `/auth/login?returnTo=/private` if unauthenticated

### Key SDK behavior demonstrated

Visiting `http://app1.localhost:3000` and initiating login causes the SDK to:
1. Infer the request origin as `http://app1.localhost:3000`
2. Match it against the allow-list
3. Use `http://app1.localhost:3000/auth/callback` as the `redirect_uri`

The same flow on `http://app2.localhost:3000` uses `http://app2.localhost:3000/auth/callback` — same config, correct URL per request.

## Views

Views are copied/adapted from `example-express-web` with no functional changes. The focus of this example is the configuration, not the UI.

## README

The README covers:

1. Installing dependencies
2. Adding `/etc/hosts` entries
3. Creating `.env` from `.env.example` and filling in Auth0 credentials
4. Configuring the Auth0 tenant (allowed callback/logout/origin URLs)
5. Running the app with `npm run start`
6. Testing: open both `http://app1.localhost:3000` and `http://app2.localhost:3000` in the browser and walk through login/logout on each

## Error handling

No changes to error handling beyond what the SDK already provides. If a request origin is not in the allow-list, the SDK throws `InvalidConfigurationError` and the login handler returns a 500 with the error message — consistent with the existing example.
