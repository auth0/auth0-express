# Examples

- [Configuration](#configuration)
  - [Basic configuration](#basic-configuration)
  - [Using environment variables](#using-environment-variables)
  - [Configuring a `customFetch` implementation](#configuring-a-customfetch-implementation)
- [Protecting API Routes](#protecting-api-routes)
  - [Basic authentication](#basic-authentication)
  - [Requiring specific scopes](#requiring-specific-scopes)
  - [Flexible scope matching](#flexible-scope-matching)
  - [Custom user type](#custom-user-type)
- [Authorization with Claims](#authorization-with-claims)
  - [Using claimEquals](#using-claimequals)
  - [Using claimIncludes](#using-claimincludes)
  - [Using claimCheck for custom logic](#using-claimcheck-for-custom-logic)
- [API as a client](#api-as-a-client)
  - [The `ApiClient` instance](#the-apiclient-instance)
  - [Calling another API on behalf of the user](#calling-another-api-on-behalf-of-the-user)
    - [Prerequisites](#prerequisites)
    - [Handling a failed exchange](#handling-a-failed-exchange)
    - [Exchanging a different token](#exchanging-a-different-token)
    - [Reading the delegation chain](#reading-the-delegation-chain)

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

The client credentials are only needed to call a downstream API on behalf of the caller. If you provide any of them, provide a complete set: `AUTH0_CLIENT_ID` plus either `AUTH0_CLIENT_SECRET` or `AUTH0_CLIENT_ASSERTION_SIGNING_KEY`. An incomplete set is reported when you make the call, not at startup, because nothing else in the SDK needs them.

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

## Protecting API Routes

### Basic authentication

In order to protect an API route, you can use the `requiresAuth` middleware:

```ts
import { requiresAuth } from '@auth0/auth0-express-api';

app.get(
  '/protected-api',
  requiresAuth(),
  async (req, res) => {
    res.json({ message: `Hello, ${req.auth0.user!.sub}` });
  }
);
```

The SDK exposes the claims, extracted from the token, as the `user` property on the `req.auth0` object. It is optional on the type, because only `requiresAuth()` sets it, so a route behind that middleware can assert it with `!`.

### Requiring specific scopes

You can require **all** of the specified scopes by passing them to the `requiresAuth` middleware:

```ts
app.get(
  '/admin/edit',
  requiresAuth({ scopes: ['read:admin', 'write:admin'] }),
  async (req, res) => {
    res.json({ message: 'Admin editor access granted' });
  }
);
```

### Flexible scope matching

The `scopesInclude` middleware allows you to check for multiple scopes with flexible matching:

```ts
import { requiresAuth, scopesInclude } from '@auth0/auth0-express-api';

// Match ANY of the scopes
app.get(
  '/messages',
  requiresAuth(),
  scopesInclude('read:messages read:admin', { match: 'any' }),
  async (req, res) => {
    res.json({ message: 'Access granted with either scope' });
  }
);

// Match ALL of the scopes (default behavior)
app.get(
  '/admin/edit',
  requiresAuth(),
  scopesInclude('read:admin write:admin'),
  async (req, res) => {
    res.json({ message: 'Access granted with both scopes' });
  }
);
```

You can also pass an array of scopes:

```ts
// Match ANY
app.get('/messages', requiresAuth(), scopesInclude(['read:messages', 'read:admin'], { match: 'any' }), handler);

// Match ALL (default)
app.get('/admin/edit', requiresAuth(), scopesInclude(['read:admin', 'write:admin']), handler);
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
  requiresAuth(),
  async (req, res) => {
    res.json({ message: `Hello, ${req.auth0.user!.name}` });
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
import { requiresAuth, claimEquals } from '@auth0/auth0-express-api';

app.get(
  '/admin',
  requiresAuth(),
  claimEquals('isAdmin', true),
  async (req, res) => {
    res.json({ message: 'Admin access granted' });
  }
);
```

The `claimEquals` middleware supports strings, numbers, and booleans values:

```ts
// String comparison
app.get('/vip', requiresAuth(), claimEquals('tier', 'premium'), handler);

// Number comparison
app.get('/level-5', requiresAuth(), claimEquals('level', 5), handler);

// Boolean comparison
app.get('/verified', requiresAuth(), claimEquals('emailVerified', true), handler);
```

### Using claimIncludes

Check if a claim (array or space-separated string) includes all specified values:

```ts
import { requiresAuth, claimIncludes } from '@auth0/auth0-express-api';

app.get(
  '/admin/edit',
  requiresAuth(),
  claimIncludes('roles', ['admin', 'editor']),
  async (req, res) => {
    res.json({ message: 'Access granted to admin editors' });
  }
);
```

### Using claimCheck for custom logic

For complex authorization logic, use `claimCheck` with a custom validation function:

```ts
import { requiresAuth, claimCheck } from '@auth0/auth0-express-api';

app.get(
  '/premium-content',
  requiresAuth(),
  claimCheck(
    (req, token) => {
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

The validation function receives the Express request and the full token payload, and should return `true` to grant access.

The second parameter is an optional configuration object that can include a custom error message to be returned if the check fails. If not provided, a default error message will be used.

> [!NOTE]
> All claim authorization middlewares should be used **after** `requiresAuth()` to ensure a valid token is present. They will return 401 errors if the token doesn't meet the required claim conditions.

## API as a client

Everything above is about **token verification**: a token arrives at your API and the SDK checks it before your route runs. This section is the other direction, where your API acts as a **client** of Auth0 and asks it for a token, usually so it can call another API.

Both come out of the same router. `requiresAuth()` verifies the incoming token, and `req.auth0.client` is the client you call to get a new one. Acting as a client needs credentials, so configure `clientId` together with either `clientSecret` or `clientAssertionSigningKey`.

### The `ApiClient` instance

Once the SDK is registered, an instance of the Auth0 `ApiClient` is available via `req.auth0.client`. This instance can be used to call any of the methods available on the `ApiClient`, such as `verifyAccessToken()`.

It is attached to every request, including unauthenticated ones, and it is the same instance each time rather than one built per request.

For the complete list of available methods, please refer to the [@auth0/auth0-api-js SDK documentation](https://github.com/auth0/auth0-auth-js/blob/main/packages/auth0-api-js/README.md).

### Calling another API on behalf of the user

When your API needs to call a second API, it should not forward its own access token. That token was issued for your audience, not the next one. Instead, exchange it for a token issued for the downstream API, still representing the same user. This is [On-Behalf-Of token exchange](https://auth0.com/docs/secure/call-apis-on-users-behalf/on-behalf-of-token-exchange), built on [RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693).

#### Prerequisites

Client credentials alone are not enough. Both the SDK and the tenant need setting up first:

- Configure `clientId` together with either `clientSecret` or `clientAssertionSigningKey`. A public client cannot do this exchange, because the actor identity comes from client authentication.
- Register your API as a **Custom API client** in the Auth0 Dashboard, so it has a client identity to authenticate with. Only a Custom API client associated with a resource server can exchange tokens this way.
- Turn on **On-Behalf-Of Token Exchange** for that same client, under its **Token Exchange** settings. This is the toggle that allows the exchange, and it lives on the client doing the exchanging. Nothing needs enabling on the downstream API.
- Create a **user-delegated client grant** from that client to the downstream API, covering the scopes you plan to request. The scopes you can ask for come from this grant and the user's own RBAC policies.
- Skip user consent for the downstream API, since the client is first-party.

Without these, the exchange fails at the tenant rather than in the SDK. See [On-Behalf-Of token exchange](https://auth0.com/docs/secure/call-apis-on-users-behalf/on-behalf-of-token-exchange) for the current dashboard steps.

```ts
import { requiresAuth } from '@auth0/auth0-express-api';

app.get('/orders', requiresAuth(), async (req, res) => {
  const { accessToken } = await req.auth0.client.getTokenOnBehalfOf(req.auth0.token!, {
    audience: 'https://orders.example.com',
    scope: 'read:orders',
  });

  const orders = await fetch('https://orders.example.com/orders', {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  res.json(await orders.json());
});
```

The first argument is the token to exchange, and passing it is your job. On a route behind `requiresAuth()`, `req.auth0.token` is the token the SDK just verified, which is the one you want here.

> [!NOTE]
> Because the subject token is a plain argument, the same method works for any token your API holds, not only the current request's. That is what makes a background job or a stored token possible. See [Exchanging a different token](#exchanging-a-different-token).

> [!CAUTION]
> `req.auth0.token` is a live credential. It is defined as non-enumerable, so `JSON.stringify(req.auth0)`, `{ ...req.auth0 }` and `console.log(req.auth0)` all leave it out. Tools that read properties by name can still reach it, and the redaction rules your logger applies to the `Authorization` header will not cover it. Keep it out of logs, error reports and responses, and do not hold on to `req` after the response is sent.

Alongside `accessToken`, the result carries `expiresAt` (seconds since the Unix epoch), and `scope`, `tokenType` and `issuedTokenType` when the tenant returns them.

> [!NOTE]
> `getTokenOnBehalfOf()` calls the token endpoint every time. Nothing is cached for you, so calling it on every request adds a round trip to Auth0 on every request and counts against your tenant's rate limits. Use `expiresAt` to cache the result, keyed on the user **and** the downstream audience and scope, and expire it a little before `expiresAt`. An exchanged token is a user credential, so whatever holds it has to be scoped per user and cleared when their session ends.

> [!NOTE]
> The downstream API sees a token whose `sub` is still the end user, with your API recorded as the actor in the `act` claim. Authorization decisions downstream continue to be about the user, not about your service.

#### Handling a failed exchange

The exchange runs in your route handler, so nothing in the SDK turns a failure into an HTTP response, and what happens if you leave it unhandled depends on your Express version. On **Express 5** the rejection is forwarded to your error handler, which returns a 500 by default. On **Express 4** it is not: the request hangs with no response and the rejection goes unhandled, which under Node's default settings takes the process down. Catch it either way and decide what the caller should see:

```ts
import { requiresAuth, TokenExchangeError } from '@auth0/auth0-express-api';

app.get('/orders', requiresAuth(), async (req, res) => {
  try {
    const { accessToken } = await req.auth0.client.getTokenOnBehalfOf(req.auth0.token!, {
      audience: 'https://orders.example.com',
    });
    res.json(await fetchOrders(accessToken));
  } catch (error) {
    // Narrowing is needed because a caught value is `unknown` under `strict`.
    // `cause` is what the tenant actually said, e.g. that the client is not
    // authorized for this audience. Useful in your logs, not in the response.
    if (error instanceof TokenExchangeError) {
      console.error(error.code, error.cause?.error_description);
    }
    res.status(502).json({ error: 'downstream_unavailable' });
  }
});
```

The errors you can get are:

| `error.code` | What happened |
| --- | --- |
| `missing_client_auth_error` | The router has no client credentials, or has a `clientId` without a matching `clientSecret` or `clientAssertionSigningKey`. A configuration bug, not a request problem. |
| `token_exchange_error` | The tenant rejected the exchange, or the subject token you passed was missing or unusable. Read `error.cause?.error_description`. |

A missing subject token also comes back as a `token_exchange_error`, with the message `subject_token is required`. That usually means the route is not behind `requiresAuth()`, so `req.auth0.token` was `undefined` and the non-null assertion was wrong. On that path the error is raised locally and there is no `cause`, which is why the example reads it with `?.`.

A `token_exchange_error` is otherwise a tenant setup problem on first run, so check the [prerequisites](#prerequisites) before treating it as a runtime failure. Do not pass `error.cause?.error_description` through to the caller, since it describes your tenant configuration.

> [!NOTE]
> `TokenExchangeError` and `MissingClientAuthError` come from `@auth0/auth0-auth-js` and do not extend `AuthError`, so `error instanceof AuthError` will not catch them. Narrow to the specific class as above, or branch on `error.code`, which every error this SDK surfaces carries.

#### Exchanging a different token

Nothing ties the subject token to the current request, so you can exchange a token that came from somewhere else, such as one held for a background job:

```ts
app.post('/sync', requiresAuth({ scopes: 'run:jobs' }), async (req, res) => {
  // A token your API stored earlier for this job, not something the caller sent.
  // The lookup is scoped to the caller, so naming someone else's job resolves
  // to nothing rather than to their token.
  const subjectToken = await loadStoredToken(req.auth0.user!.sub, req.body.jobId);

  const { accessToken } = await req.auth0.client.getTokenOnBehalfOf(subjectToken, {
    audience: 'https://orders.example.com',
  });

  res.json(await syncOrders(accessToken));
});
```

The exchange can fail here for the same reasons as anywhere else, so wrap it as shown in [Handling a failed exchange](#handling-a-failed-exchange). Left out above to keep the example about the subject token.

> [!WARNING]
> Never take the subject token from the request body, query string or headers. Doing so lets a caller nominate any token they hold as the subject, and your API will exchange it as though it had verified it. Pass only tokens your API obtained and stored itself, or `req.auth0.token`, and keep the route protected so you still know who is asking.

#### Reading the delegation chain

A token obtained through an exchange carries an `act` claim naming the actor that requested it. If your API is itself called by another service, you can read that chain:

```ts
import { requiresAuth, getCurrentActor, getDelegationChain } from '@auth0/auth0-express-api';

app.get('/whoami', requiresAuth(), async (req, res) => {
  res.json({
    user: req.auth0.user!.sub,
    // The service that called us, or undefined if the user called us directly.
    actor: getCurrentActor(req.auth0.user!),
    // Every actor, newest first, e.g. ['service-b', 'service-a'].
    chain: getDelegationChain(req.auth0.user!),
  });
});
```

Auth0 limits the delegation chain to **five nested levels**. Each exchange adds one, so a subject token that already carries four is rejected: you get a `token_exchange_error` whose `cause?.error_description` says the `act` claim depth exceeds the maximum allowed limit of 4. A long chain of services each calling the next on behalf of the user is not something to design around.
