![Auth0-Express](assets/images/banner.png)
Auth0-Express Mono Repo, containing SDKs for implementing user authentication in Express applications.

![Release](https://img.shields.io/npm/v/@auth0/auth0-express)
![Downloads](https://img.shields.io/npm/dw/@auth0/auth0-express)
[![License](https://img.shields.io/badge/license-Apache%20License%202.0-blue)](https://opensource.org/license/apache-2-0)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/auth0/auth0-express)

📚 [Packages](#packages) - 💬 [Feedback](#feedback)

## Packages

- [`auth0-express`](./packages/auth0-express/README.md) - Authentication SDK for Express Applications on JavaScript runtimes.
- [`auth0-express-api`](./packages/auth0-express-api/README.md) - Authentication SDK for Express API's on JavaScript runtimes.

## Running Examples

The following examples can be found in the examples directory:

- [Express Web App Example](./examples/example-express-web/README.md)
- [Express API Example](./examples/example-express-api/README.md)
- [Express Web App Calling an API Example](./examples/example-express-web-call-api/README.md)

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
