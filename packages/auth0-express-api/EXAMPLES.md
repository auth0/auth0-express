# Examples

- [Configuration](#configuration)
  - [Basic configuration](#basic-configuration)
  - [Using environment variables](#using-environment-variables)
  - [Configuring a `customFetch` implementation](#configuring-a-customfetch-implementation)
- [The `ApiClient` instance](#the-apiclient-instance)
- [Protecting API Routes](#protecting-api-routes)
  - [Basic authentication](#basic-authentication)
  - [Requiring specific scopes](#requiring-specific-scopes)
  - [Flexible scope matching](#flexible-scope-matching)
  - [Custom user type](#custom-user-type)
- [Authorization with Claims](#authorization-with-claims)
  - [Using claimEquals](#using-claimequals)
  - [Using claimIncludes](#using-claimincludes)
  - [Using claimCheck for custom logic](#using-claimcheck-for-custom-logic)

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

For client assertion-based authentication (using private key JWT):

```env
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.example.com
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_ASSERTION_SIGNING_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
-----END PRIVATE KEY-----"
```

Note that `clientAssertionSigningAlg` should be specified in code (e.g., `RS256`, `RS384`, `RS512`) as it's a configuration choice rather than a secret.

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

### Basic authentication

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

You can require **all** of the specified scopes by passing them to the `requireAuth` middleware:

```ts
app.get(
  '/admin/edit',
  requireAuth({ scopes: ['read:admin', 'write:admin'] }),
  async (req, res) => {
    res.json({ message: 'Admin editor access granted' });
  }
);
```

### Flexible scope matching

The `scopesInclude` middleware allows you to check for multiple scopes with flexible matching:

```ts
import { requireAuth, scopesInclude } from '@auth0/auth0-express-api';

// Match ANY of the scopes (default behavior)
app.get(
  '/messages',
  requireAuth(),
  scopesInclude('read:messages read:admin'),
  async (req, res) => {
    res.json({ message: 'Access granted with either scope' });
  }
);

// Match ALL of the scopes
app.get(
  '/admin/edit',
  requireAuth(),
  scopesInclude('read:admin write:admin', { match: 'all' }),
  async (req, res) => {
    res.json({ message: 'Access granted with both scopes' });
  }
);
```

You can also pass an array of scopes:

```ts
// Match ANY (default)
app.get('/messages', requireAuth(), scopesInclude(['read:messages', 'read:admin']), handler);

// Match ALL
app.get('/admin/edit', requireAuth(), scopesInclude(['read:admin', 'write:admin'], { match: 'all' }), handler);
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

## Authorization with Claims

Beyond scope-based authorization, you can authorize requests based on specific token claims using middleware that checks claim values.

### Using claimEquals

Check if a claim equals a specific value:

```ts
import { requireAuth, claimEquals } from '@auth0/auth0-express-api';

app.get(
  '/admin',
  requireAuth(),
  claimEquals('isAdmin', true),
  async (req, res) => {
    res.json({ message: 'Admin access granted' });
  }
);
```

The `claimEquals` middleware supports strings, numbers, and booleans values:

```ts
// String comparison
app.get('/vip', requireAuth(), claimEquals('tier', 'premium'), handler);

// Number comparison
app.get('/level-5', requireAuth(), claimEquals('level', 5), handler);

// Boolean comparison
app.get('/verified', requireAuth(), claimEquals('emailVerified', true), handler);
```

### Using claimIncludes

Check if a claim (array or space-separated string) includes all specified values:

```ts
import { requireAuth, claimIncludes } from '@auth0/auth0-express-api';

app.get(
  '/admin/edit',
  requireAuth(),
  claimIncludes('roles', ['admin', 'editor']),
  async (req, res) => {
    res.json({ message: 'Access granted to admin editors' });
  }
);
```
```

### Using claimCheck for custom logic

For complex authorization logic, use `claimCheck` with a custom validation function:

```ts
import { requireAuth, claimCheck } from '@auth0/auth0-express-api';

app.get(
  '/premium-content',
  requireAuth(),
  claimCheck(
    (token) => {
      // Custom logic: require either premium tier OR admin role
      return token.tier === 'premium' || token.roles?.includes('admin');
    },
    { errorMessage: 'Premium tier or admin role required' }
  ),
  async (req, res) => {
    res.json({ message: 'Access granted to premium content' });
  }
);
```

The validation function receives the full token payload and should return `true` to grant access.

The second parameter is an optional configuration object that can include a custom error message to be returned if the check fails. If not provided, a default error message will be used.

> [!NOTE]
> All claim authorization middlewares should be used **after** `requireAuth()` to ensure a valid token is present. They will return 401 errors if the token doesn't meet the required claim conditions.
