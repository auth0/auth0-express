# Examples

- [Configuration](#configuration)
  - [Basic configuration](#basic-configuration)
  - [Using environment variables](#using-environment-variables)
  - [Configuring a `customFetch` implementation](#configuring-a-customfetch-implementation)
- [The `ApiClient` instance](#the-apiclient-instance)
- [Protecting API Routes](#protecting-api-routes)

## Configuration

### Basic configuration

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

### Using environment variables

The SDK automatically reads configuration from environment variables, making it easy to configure without hardcoding values:

```ts
import express from 'express';
import { createAuth0Api } from '@auth0/auth0-express-api';

const app = express();

// Configuration is automatically read from environment variables
app.use(createAuth0Api());
```

Supported environment variables:
- `AUTH0_DOMAIN` - Your Auth0 domain
- `AUTH0_AUDIENCE` - Your API audience/identifier
- `AUTH0_CLIENT_ID` - Your Auth0 application client ID (optional)
- `AUTH0_CLIENT_SECRET` - Your Auth0 application client secret (optional)
- `AUTH0_CLIENT_ASSERTION_SIGNING_KEY` - Private key for client assertion signing (optional)

Example `.env` file:

```env
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.example.com
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
```

You can also override specific values while using environment variables for others:

```ts
app.use(createAuth0Api({
  audience: 'https://api-override.example.com' // Override while using env vars for other config
}));
```

> [!NOTE]
> For compatibility with express-oauth2-jwt-bearer, alternative environment variable names are supported: `ISSUER_BASE_URL` (for domain) and `AUDIENCE`. The `AUTH0_*` prefixed names are recommended.

### Configuring a `customFetch` implementation

The SDK allows to override the fetch implementation, used for making HTTP requests, by providing a custom implementation when setting up the SDK:

```ts
import express from 'express';
import { createAuth0Api } from '@auth0/auth0-express-api';

const app = express();

app.use(createAuth0Api({
  /* ... */
  customFetch: async (input, init) => {
    // Custom fetch implementation
  },
}));
```

## The `ApiClient` instance

Once the SDK is registered, an instance of the Auth0 `ApiClient` is available via `req.auth0.client`. This instance can be used to call any of the methods available on the `ApiClient`, such as `verifyAccessToken()`.

For the complete list of available methods, please refer to the [@auth0/auth0-api-js SDK documentation](https://github.com/auth0/auth0-auth-js/blob/main/packages/auth0-api-js/README.md).

## Protecting API Routes

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

### Requiring specific scopes

You can also require specific scopes by passing them to the `requireAuth` middleware:

```ts
app.get(
  '/admin',
  requireAuth({ scopes: ['admin'] }),
  async (req, res) => {
    res.json({ message: 'Admin only' });
  }
);
```

### Custom user type

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