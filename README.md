![Auth0-Express](assets/images/banner.png)
Auth0-Express Mono Repo, containing SDKs for implementing user authentication in Express applications.

![Release](https://img.shields.io/npm/v/@auth0/auth0-express)
![Downloads](https://img.shields.io/npm/dw/@auth0/auth0-express)
[![License](https://img.shields.io/badge/license-Apache%20License%202.0-blue)](https://opensource.org/license/apache-2-0)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/auth0/auth0-express)

📚 [Packages](#packages) - 🧭 [Choosing an SDK](#choosing-an-sdk) - 🔎 [Feature Index](#feature-index) - 💬 [Feedback](#feedback)

## Packages

- [`@auth0/auth0-express`](./packages/auth0-express/README.md) - Authentication SDK for **Express web applications** (server-rendered apps using sessions/cookies). Handles login, logout, callback, and session management.
- [`@auth0/auth0-express-api`](./packages/auth0-express-api/README.md) - Authentication SDK for **Express APIs** (resource servers). Validates bearer access tokens and authorizes requests by scopes and claims.

## Choosing an SDK

| Your application | Use | Authenticates with |
| --- | --- | --- |
| A server-rendered web app where users log in (sessions/cookies) | [`@auth0/auth0-express`](./packages/auth0-express/README.md) | Browser session cookie |
| An API / resource server consumed by SPAs, mobile, or services | [`@auth0/auth0-express-api`](./packages/auth0-express-api/README.md) | `Authorization: Bearer <access_token>` |
| A web app that *also* calls your own API on the user's behalf | Both — `auth0-express` for login + token, `auth0-express-api` to protect the API | Session + bearer token |

## Feature Index

Jump straight to the capability you need.

### `@auth0/auth0-express` — Web applications

| Feature | Where |
| --- | --- |
| Quick start (`createAuth0`) | [README → Getting Started](./packages/auth0-express/README.md#getting-started) |
| Configure via environment variables | [README](./packages/auth0-express/README.md#using-environment-variables) · [EXAMPLES](./packages/auth0-express/EXAMPLES.md#using-environment-variables) |
| Migrating from `express-openid-connect` (env var aliases) | [README → Using Environment Variables](./packages/auth0-express/README.md#using-environment-variables) |
| Built-in routes (`/auth/login`, `/auth/logout`, `/auth/callback`, back-channel logout) | [README → Routes](./packages/auth0-express/README.md#routes) |
| Custom login / logout / callback (no mounted routes) | [README → Adding Login and Logout](./packages/auth0-express/README.md#3-adding-login-and-logout) |
| Configure or disable mounted routes | [EXAMPLES → Configuring the mounted routes](./packages/auth0-express/EXAMPLES.md#configuring-the-mounted-routes) |
| Protect a route with a session | [README → Protecting Routes](./packages/auth0-express/README.md#4-protecting-routes) · [EXAMPLES](./packages/auth0-express/EXAMPLES.md#protecting-routes) |
| Get the current session / user | [README → Protecting Routes](./packages/auth0-express/README.md#4-protecting-routes) |
| Call an API on the user's behalf (`getAccessToken`) | [README → Requesting an Access Token](./packages/auth0-express/README.md#requesting-an-access-token-to-call-an-api) · [EXAMPLES](./packages/auth0-express/EXAMPLES.md#requesting-an-access-token-to-call-an-api) |
| Authorization with claims (`claimEquals`, `claimIncludes`, `claimCheck`) | [EXAMPLES → Authorization with Claims](./packages/auth0-express/EXAMPLES.md#authorization-with-claims) |
| Dynamic / multiple app base URLs (host inference, allow-list) | [EXAMPLES → Dynamic Application Base URLs](./packages/auth0-express/EXAMPLES.md#dynamic-application-base-urls) |
| Multiple Custom Domains (MCD) | [EXAMPLES → Multiple Custom Domains](./packages/auth0-express/EXAMPLES.md#multiple-custom-domains-mcd) |
| Custom `fetch` implementation | [EXAMPLES → Configuring a `customFetch`](./packages/auth0-express/EXAMPLES.md#configuring-a-customfetch-implementation) |
| Discovery cache | [EXAMPLES → Discovery Cache](./packages/auth0-express/EXAMPLES.md#discovery-cache) |

### `@auth0/auth0-express-api` — APIs

| Feature | Where |
| --- | --- |
| Quick start (`createAuth0Api`) | [README → Getting Started](./packages/auth0-express-api/README.md#getting-started) |
| Configure via environment variables | [EXAMPLES → Using environment variables](./packages/auth0-express-api/EXAMPLES.md#using-environment-variables) |
| Protect an API route with a bearer token (`requiresAuth`) | [README → Protecting API Routes](./packages/auth0-express-api/README.md#protecting-api-routes) · [EXAMPLES](./packages/auth0-express-api/EXAMPLES.md#protecting-api-routes) |
| Read token claims (`req.auth0.user`) | [README → Protecting API Routes](./packages/auth0-express-api/README.md#protecting-api-routes) |
| Require specific scopes (`scopesInclude`, match any/all) | [EXAMPLES → Requiring specific scopes](./packages/auth0-express-api/EXAMPLES.md#requiring-specific-scopes) |
| Authorization with claims (`claimEquals`, `claimIncludes`, `claimCheck`) | [README → Authorization with Claims](./packages/auth0-express-api/README.md#authorization-with-claims) · [EXAMPLES](./packages/auth0-express-api/EXAMPLES.md#authorization-with-claims) |
| Custom token / user type (module augmentation) | [README → Custom Types](./packages/auth0-express-api/README.md#custom-types) · [EXAMPLES](./packages/auth0-express-api/EXAMPLES.md#custom-user-type) |
| Custom `fetch` implementation | [EXAMPLES → Configuring a `customFetch`](./packages/auth0-express-api/EXAMPLES.md#configuring-a-customfetch-implementation) |

## Running Examples

The following examples can be found in the examples directory:

- [Express Web App Example](./examples/example-express-web/README.md)
- [Express API Example](./examples/example-express-api/README.md)

Before running the examples, you need to install the dependencies for the monorepo and build all the packages.

1. Install depedencies

```bash
$ npm install
```

2. Build all packages

```bash
$ npm run build
```

3. Follow example instructions

## Feedback

### Contributing

We appreciate feedback and contribution to this repo! Before you get started, please read the following:

- [Auth0's general contribution guidelines](https://github.com/auth0/open-source-template/blob/master/GENERAL-CONTRIBUTING.md)
- [Auth0's code of conduct guidelines](https://github.com/auth0/auth0-express/blob/main/CODE-OF-CONDUCT.md)
- [This repo's contribution guide](./CONTRIBUTING.md)

### Raise an issue

To provide feedback or report a bug, please [raise an issue on our issue tracker](https://github.com/auth0/auth0-express/issues).

## Vulnerability Reporting

Please do not report security vulnerabilities on the public GitHub issue tracker. The [Responsible Disclosure Program](https://auth0.com/responsible-disclosure-policy) details the procedure for disclosing security issues.

## What is Auth0?

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.auth0.com/website/sdks/logos/auth0_dark_mode.png" width="150">
    <source media="(prefers-color-scheme: light)" srcset="https://cdn.auth0.com/website/sdks/logos/auth0_light_mode.png" width="150">
    <img alt="Auth0 Logo" src="https://cdn.auth0.com/website/sdks/logos/auth0_light_mode.png" width="150">
  </picture>
</p>
<p align="center">
  Auth0 is an easy to implement, adaptable authentication and authorization platform. To learn more checkout <a href="https://auth0.com/why-auth0">Why Auth0?</a>
</p>
<p align="center">
  This project is licensed under the Apache License 2.0. See the <a href="https://github.com/auth0/auth0-express/blob/main/LICENSE"> LICENSE</a> file for more info.
</p>
