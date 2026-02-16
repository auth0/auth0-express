The Auth0 Express-API SDK is a library for protecting API's in Express applications.

![Release](https://img.shields.io/npm/v/@auth0/auth0-express-api)
![Downloads](https://img.shields.io/npm/dw/@auth0/auth0-express-api)
[![License](https://img.shields.io/badge/license-Apache%20License%202.0-blue)](https://opensource.org/license/apache-2-0)

📚 [Documentation](#documentation) - 🚀 [Getting Started](#getting-started) - 💬 [Feedback](#feedback)

## Documentation

- [Examples](https://github.com/auth0/auth0-express/blob/main/packages/auth0-express-api/EXAMPLES.md) - examples for your different use cases.
- [Docs Site](https://auth0.com/docs) - explore our docs site and learn more about Auth0.

## Getting Started

### 1. Install the SDK

```shell
npm i @auth0/auth0-express-api
```

This library requires Node.js 20 LTS and newer LTS versions.

### 3. Register the Auth0 Express API router

Register the Auth0 Express API router with your Express instance.

```ts
import express from 'express';
import { createAuth0Api } from '@auth0/auth0-express-api';

const app = express();

app.use(createAuth0Api({
  domain: '<AUTH0_DOMAIN>',
  audience: '<AUTH0_AUDIENCE>',
}));
```
The `AUTH0_DOMAIN` can be obtained from the [Auth0 Dashboard](https://manage.auth0.com) once you've created an API.
The `AUTH0_AUDIENCE` is the identifier of the API that is being called. You can find this in the API section of the Auth0 dashboard.

**Environment Variable Support**: You can also configure the SDK using environment variables (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`). See [EXAMPLES.md](https://github.com/auth0/auth0-express/blob/main/packages/auth0-express-api/EXAMPLES.md#using-environment-variables) for details.

#### Protecting API Routes

In order to protect an API route, you can use the `requireAuth` middleware:

```ts
import { requireAuth } from '@auth0/auth0-express-api';

app.get(
  '/protected-api',
  requireAuth(),
  async (req, res) => {
    res.json({ message: `Hello, ${req.auth0.user.sub}` });
  }
);
```

The SDK exposes the claims, extracted from the token, as the `user` property on the `req.auth0` object.

#### Authorization with Claims

Beyond basic authentication, you can authorize requests based on specific token claims:

```ts
import {
  requireAuth,
  claimEquals,
  claimIncludes,
  claimCheck,
  scopesInclude,
} from '@auth0/auth0-express-api';

// Check if a claim equals a specific value
app.get('/admin', requireAuth(), claimEquals('isAdmin', true), handler);

// Check if a claim includes all specified values
app.get('/admin/edit', requireAuth(), claimIncludes('roles', 'admin', 'editor'), handler);

// Custom validation logic
app.get('/premium', requireAuth(), claimCheck(
  (token) => token.tier === 'premium' || token.roles?.includes('admin'),
  'Premium tier or admin role required'
), handler);

// Flexible scope matching - match ANY (default) or ALL
app.get('/messages', requireAuth(), scopesInclude('read:messages read:admin'), handler);
app.get('/admin/edit', requireAuth(), scopesInclude('read:admin write:admin', { match: 'all' }), handler);
```

See [EXAMPLES.md](https://github.com/auth0/auth0-express/blob/main/packages/auth0-express-api/EXAMPLES.md#authorization-with-claims) for more authorization patterns.

#### Custom Types

In order to use a custom user type to represent custom claims, you can configure the `Token` type in a module augmentation:

```ts
declare module '@auth0/auth0-express-api' {
  interface Token {
    id: number;
    name: string;
    age: number;
  }
}
```

Doing so will change the user type on the `req.auth0.user` object automatically:

```ts
app.get(
  '/protected-api',
  requireAuth(),
  async (req, res) => {
    res.json({ message: `Hello, ${req.auth0.user.name}` });
  }
);
```

> [!IMPORTANT]
> The above is to protect API routes by the means of a bearer token, and not server-side rendering routes using a session. 


## Feedback

### Contributing

We appreciate feedback and contribution to this repo! Before you get started, please read the following:

- [Auth0's general contribution guidelines](https://github.com/auth0/open-source-template/blob/master/GENERAL-CONTRIBUTING.md)
- [Auth0's code of conduct guidelines](https://github.com/auth0/open-source-template/blob/master/CODE-OF-CONDUCT.md)
- [This repo's contribution guide](https://github.com/auth0/auth0-express/blob/main/CONTRIBUTING.md)

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
  This project is licensed under the Apache License 2.0. See the <a href="https://github.com/auth0/auth0-express/blob/main/packages/auth0-express-api/LICENSE"> LICENSE</a> file for more info.
</p>