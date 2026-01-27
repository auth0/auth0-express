# Examples

- [Configuration](#configuration)
  - [Basic configuration](#basic-configuration)
  - [Configuring a `customFetch` implementation](#configuring-a-customfetch-implementation)
- [Protecting API Routes](#protecting-api-routes)

## Configuration

### Basic configuration

Register the Auth0 Express middleware with your Express instance.

```ts
import express from 'express';
import { createRequireAuthMiddleware } from '@auth0/auth0-express-api';

const app = express();

app.use(createRequireAuthMiddleware({
  domain: '<AUTH0_DOMAIN>',
  audience: '<AUTH0_AUDIENCE>',
}));
```

The `AUTH0_DOMAIN` can be obtained from the [Auth0 Dashboard](https://manage.auth0.com) once you've created an application. 
The `AUTH0_AUDIENCE` is the identifier of the API that is being called. You can find this in the API section of the Auth0 dashboard.

### Configuring a `customFetch` implementation

The SDK allows to override the fetch implementation, used for making HTTP requests, by providing a custom implementation when setting up the middleware:

```ts
import express from 'express';
import { createRequireAuthMiddleware } from '@auth0/auth0-express-api';

const app = express();

app.use(createRequireAuthMiddleware({
  /* ... */
  customFetch: async (input, init) => {
    // Custom fetch implementation
  },
}));
```

## The `ApiClient` instance

Once the middleware is registered, an instance of the Auth0 `ApiClient` is available via `req.auth0.client`. This instance can be used to call any of the methods available on the `ApiClient`, such as `verifyAccessToken()` and `getAccessTokenForConnection()`.

For the complete list of available methods, please refer to the [@auth0/auth0-api-js SDK documentation](https://github.com/auth0/auth0-auth-js/blob/main/packages/auth0-api-js/README.md).

## Protecting API Routes

In order to protect an API route, you can use the SDK's middleware in your route handler:

```ts
import express from 'express';
import { createRequireAuthMiddleware } from '@auth0/auth0-express-api';

const app = express();

app.use(createRequireAuthMiddleware({
  domain: '<AUTH0_DOMAIN>',
  audience: '<AUTH0_AUDIENCE>',
}));
```
The `AUTH0_DOMAIN` can be obtained from the [Auth0 Dashboard](https://manage.auth0.com) once you've created an API.
The `AUTH0_AUDIENCE` is the identifier of the API that is being called. You can find this in the API section of the Auth0 dashboard.

```ts
app.get(
  '/protected-api',
  createRequireAuthMiddleware(),
  async (req, res) => {
    res.json({ message: `Hello, ${req.auth0.user.sub}` });
  }
);
```

The SDK exposes the claims, extracted from the token, as the `user` property on the `req.auth0` object.
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
  createRequireAuthMiddleware(),
  async (req, res) => {
    res.json({ message: `Hello, ${req.auth0.user.name}` });
  }
);
```

> [!IMPORTANT]  
> The above is to protect API routes by the means of a bearer token, and not server-side rendering routes using a session. 