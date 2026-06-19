![Auth0-Express](assets/images/banner.png)
Auth0-Express Mono Repo, containing SDKs for implementing user authentication in Express applications.

![Release](https://img.shields.io/npm/v/@auth0/auth0-express)
![Downloads](https://img.shields.io/npm/dw/@auth0/auth0-express)
[![License](https://img.shields.io/badge/license-Apache%20License%202.0-blue)](https://opensource.org/license/apache-2-0)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/auth0/auth0-express)

📚 [Packages](#packages) - 🔎 [Feature Index](#feature-index) - 💬 [Feedback](#feedback)

## Packages

Two SDKs — pick the one that matches your application:

| Package | Use it for | Authenticates with |
| --- | --- | --- |
| [`@auth0/auth0-express`](./packages/auth0-express/README.md) | Server-rendered **web apps** where users log in. Handles login, logout, callback, and session management. | Browser session cookie |
| [`@auth0/auth0-express-api`](./packages/auth0-express-api/README.md) | **APIs** / resource servers consumed by SPAs, mobile, or services. Validates tokens and authorizes by scopes and claims. | `Authorization: Bearer <access_token>` |

## Feature Index

Jump straight to the capability you need.

### `@auth0/auth0-express` — Web applications

| Feature | What it does |
| --- | --- |
| [Quick start](./packages/auth0-express/README.md#getting-started) | Mount Auth0 with `createAuth0` in a few lines |
| [Environment variables](./packages/auth0-express/README.md#using-environment-variables) | Configure from `AUTH0_*` env vars instead of hardcoding |
| [Migrate from `express-openid-connect`](./packages/auth0-express/README.md#using-environment-variables) | Supported legacy env var aliases for an easier move |
| [Built-in routes](./packages/auth0-express/README.md#routes) | `/auth/login`, `/logout`, `/callback`, back-channel logout |
| [Custom login / logout / callback](./packages/auth0-express/README.md#3-adding-login-and-logout) | Roll your own routes instead of the mounted ones |
| [Configure mounted routes](./packages/auth0-express/EXAMPLES.md#configuring-the-mounted-routes) | Rename, re-path, or disable the built-in routes |
| [Protect a route with a session](./packages/auth0-express/README.md#4-protecting-routes) | Gate server-rendered pages behind a login session |
| [Get the current session / user](./packages/auth0-express/README.md#4-protecting-routes) | Read the authenticated user from `req.auth0` |
| [Call an API (`getAccessToken`)](./packages/auth0-express/README.md#requesting-an-access-token-to-call-an-api) | Get an access token to call APIs as the user |
| [Authorization with claims](./packages/auth0-express/EXAMPLES.md#authorization-with-claims) | Restrict routes with `claimEquals`, `claimIncludes`, `claimCheck` |
| [Dynamic app base URLs](./packages/auth0-express/EXAMPLES.md#dynamic-application-base-urls) | Infer the base URL per host or use an allow-list |
| [Multiple Custom Domains (MCD)](./packages/auth0-express/EXAMPLES.md#multiple-custom-domains-mcd) | Resolve the Auth0 domain per request |
| [Custom `fetch`](./packages/auth0-express/EXAMPLES.md#configuring-a-customfetch-implementation) | Swap in your own fetch (proxies, retries, instrumentation) |
| [Discovery cache](./packages/auth0-express/EXAMPLES.md#discovery-cache) | Control caching of OIDC discovery metadata |

### `@auth0/auth0-express-api` — APIs

| Feature | What it does |
| --- | --- |
| [Quick start](./packages/auth0-express-api/README.md#getting-started) | Protect an API with `createAuth0Api` in a few lines |
| [Environment variables](./packages/auth0-express-api/EXAMPLES.md#using-environment-variables) | Configure from `AUTH0_*` env vars instead of hardcoding |
| [Protect an API route (`requiresAuth`)](./packages/auth0-express-api/README.md#protecting-api-routes) | Require a valid bearer access token |
| [Read token claims (`req.auth0.user`)](./packages/auth0-express-api/README.md#protecting-api-routes) | Access claims extracted from the verified token |
| [Require specific scopes](./packages/auth0-express-api/EXAMPLES.md#requiring-specific-scopes) | Gate routes with `scopesInclude` (match any or all) |
| [Authorization with claims](./packages/auth0-express-api/README.md#authorization-with-claims) | Restrict routes with `claimEquals`, `claimIncludes`, `claimCheck` |
| [Custom token / user type](./packages/auth0-express-api/README.md#custom-types) | Type your custom claims via module augmentation |
| [Custom `fetch`](./packages/auth0-express-api/EXAMPLES.md#configuring-a-customfetch-implementation) | Swap in your own fetch (proxies, retries, instrumentation) |

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
