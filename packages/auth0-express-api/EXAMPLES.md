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
  - [Calling a third party API with Token Vault](#calling-a-third-party-api-with-token-vault)
    - [Prerequisites for Token Vault](#prerequisites-for-token-vault)
    - [Handling a failed connection exchange](#handling-a-failed-connection-exchange)
  - [Exchanging an external token for an Auth0 token](#exchanging-an-external-token-for-an-auth0-token)
    - [Prerequisites for Custom Token Exchange](#prerequisites-for-custom-token-exchange)
    - [Handling a failed profile exchange](#handling-a-failed-profile-exchange)
- [Personal Agents (Poppy)](#personal-agents-poppy)
  - [What changes when you turn it on](#what-changes-when-you-turn-it-on)
  - [Configure the router](#configure-the-router)
  - [Protect routes for agents](#protect-routes-for-agents)
  - [Error responses](#error-responses)
  - [Session records](#session-records)
  - [Registered agents](#registered-agents)
  - [Test your routes](#test-your-routes)
  - [Production notes](#production-notes)

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

Everything above is about **token verification**. A token arrives at your API and the SDK checks it before your route runs. This section is the other direction, where your API acts as a **client** of Auth0 and asks it for a token, usually so it can call another API.

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
> `getTokenOnBehalfOf()` calls the token endpoint every time. Nothing is cached for you, so calling it on every request adds a round trip to Auth0 and counts against your tenant's rate limits. Use `expiresAt` to cache the result, keyed on the user **and** the downstream audience and scope, and expire it a little before `expiresAt`. An exchanged token is a user credential, so whatever holds it has to be scoped per user and cleared when their session ends.

> [!NOTE]
> The downstream API sees a token whose `sub` is still the end user, with your API recorded as the actor in the `act` claim. Authorization decisions downstream continue to be about the user, not about your service.

#### Handling a failed exchange

The exchange runs in your route handler, so nothing in the SDK turns a failure into an HTTP response, and what happens if you leave it unhandled depends on your Express version. On **Express 5** the rejection is forwarded to your error handler, which returns a 500 by default. On **Express 4** it is not. The request hangs with no response and the rejection goes unhandled, which under Node's default settings takes the process down. Catch it either way and decide what the caller should see:

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

> [!IMPORTANT]
> Only the **current actor** belongs in an authorization decision. That is the outermost `act.sub`, the service that called you, which is what `getCurrentActor()` returns. Everything further down the chain is a **prior** actor: useful for logging, audit and attribution, but not something to gate access on. Those services did not call you, and you cannot tell from the claim what they were allowed to do.

Auth0 limits a delegation chain to **five actors**. Your exchange adds one, so the subject token you pass in can already carry at most **four**. Go past that and the tenant rejects the exchange with a `token_exchange_error` reporting the `act` claim depth limit. A long chain of services each calling the next on behalf of the user is not something to design around.

### Calling a third party API with Token Vault

The section above is Auth0 to Auth0. This one is Auth0 to a third party. When a user has connected an external provider such as Google or Slack, Auth0 can hold that provider's refresh token in [Token Vault](https://auth0.com/docs/secure/tokens/token-vault) and mint provider access tokens on demand. Your API exchanges the caller's verified token for one issued by the provider, then calls the provider's API as that user.

The provider's refresh token stays in Auth0. Your API only ever sees a short-lived access token.

#### Prerequisites for Token Vault

- Configure `clientId` together with either `clientSecret` or `clientAssertionSigningKey`.
- Register your API as a **Custom API client**, the same registration as for On-Behalf-Of above.
- Turn on the **Token Vault** grant type for that client. This is a different toggle from the **On-Behalf-Of Token Exchange** one, so having done the On-Behalf-Of setup does not cover you here.
- Set up the connection in Token Vault, including the upstream scopes your API needs from the provider.
- The user must have linked that provider through **Connected Accounts** and consented to those scopes. Token Vault can only mint a token for a connection the user actually linked, so a first call can fail for a perfectly valid setup simply because this user has not linked it yet.

See [Access token exchange with Token Vault](https://auth0.com/docs/secure/tokens/token-vault/access-token-exchange-with-token-vault) for the whole flow, and [Configure Token Vault](https://auth0.com/docs/secure/tokens/token-vault/configure-token-vault#configure-access-token-exchange) for the dashboard steps.

```ts
import { requiresAuth } from '@auth0/auth0-express-api';

app.get('/calendar', requiresAuth(), async (req, res) => {
  // `accessToken` names both credentials here: the one going in is your Auth0
  // token, the one coming back is Google's. Renaming the result keeps them apart.
  const { accessToken: googleAccessToken } = await req.auth0.client.getAccessTokenForConnection({
    connection: 'google-oauth2',
    accessToken: req.auth0.token!,
  });

  const events = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    headers: { authorization: `Bearer ${googleAccessToken}` },
  });

  res.json(await events.json());
});
```

Note the shape difference from `getTokenOnBehalfOf()`. Here the subject token goes **inside the options**, as `accessToken`, rather than as the first argument. That is how `@auth0/auth0-api-js` declares the two methods, and this SDK passes them through as they are rather than inventing a third signature.

The result carries `accessToken`, `scope` and `expiresAt` from the provider, plus the `connection` and `loginHint` you passed in, echoed back so a caller can tell which identity the token belongs to.

> [!CAUTION]
> The token you get back is a live third party credential, and a more powerful one than your own. It carries provider scopes such as read access to the user's calendar or mailbox, and nothing your app does to redact its own `Authorization` header covers it. Use it for server to provider calls only. Never return it to the browser, and keep it out of logs and error reports, the same as [`req.auth0.token`](#calling-another-api-on-behalf-of-the-user).

> [!NOTE]
> `AccessTokenForConnectionOptions` has no `audience`, unlike the other two exchanges. The token belongs to the provider, so an Auth0 API identifier would mean nothing to it. What you scope instead is the `connection`, plus `loginHint` when a user has more than one identity on the same connection.

> [!NOTE]
> The scopes and lifetime you get back are the provider's, not your tenant's, so do not assume the hour an Auth0 token usually gets. Cache on `expiresAt` rather than on a duration you picked, and key the cache on the user **and** the connection.

> [!WARNING]
> Pass a `loginHint` your API resolved itself, never one the caller sent. It selects which of the user's identities to mint a token for, so treating it as caller input means letting the request steer that choice. The same rule as the subject token, for the same reason.

#### Handling a failed connection exchange

Two errors can come out of this call, and they need different answers:

- `MissingClientAuthError`, when you set `clientId` without a `clientSecret` or `clientAssertionSigningKey`. Re-exported by this SDK, so `instanceof` works.
- `TokenForConnectionError`, for everything else. `@auth0/auth0-api-js` names this class in its documentation but does not export it, so there is no class to catch. Use `isConnectionExchangeError()` from this SDK, which checks the code for you.

```ts
import { requiresAuth, isConnectionExchangeError, MissingClientAuthError } from '@auth0/auth0-express-api';

app.get('/calendar', requiresAuth(), async (req, res) => {
  try {
    const { accessToken: googleAccessToken } = await req.auth0.client.getAccessTokenForConnection({
      connection: 'google-oauth2',
      accessToken: req.auth0.token!,
    });
    res.json(await fetchEvents(googleAccessToken));
  } catch (error) {
    // Your own misconfiguration, reached before any request to Auth0, so not a
    // `502`. Check this first: it does not carry the code the guard below looks for.
    if (error instanceof MissingClientAuthError) {
      console.error(error.code, error.message);
      res.status(500).json({ error: 'not_configured' });
      return;
    }

    if (isConnectionExchangeError(error)) {
      // `cause` present means the tenant refused. Absent means we never got there.
      console.error(error.code, error.cause?.error_description ?? error.message);
    }

    res.status(502).json({ error: 'calendar_unavailable' });
  }
});
```

> [!IMPORTANT]
> A half-configured client is the one case that does **not** report `token_for_connection_error`, so a guard written only on that code will miss it and fall through to whatever your generic branch does. Setting `clientId` and forgetting the secret is the easiest mistake to make here, which is why the class check comes first above.

| Condition | `error.code` | `error.cause` |
| --- | --- | --- |
| No client credentials configured at all | `token_for_connection_error` | absent, raised locally before any request to Auth0 |
| A `clientId` with no secret or assertion key | `missing_client_auth_error` | absent, raised locally |
| No subject token passed, for example calling this outside `requiresAuth()` | `token_for_connection_error` | absent, raised locally |
| Connection not in Token Vault, user never linked it, or the scopes were not granted | `token_for_connection_error` | present, carries the tenant's `error` and `error_description` |

Not being able to catch `TokenForConnectionError` by class is an upstream gap. `@auth0/auth0-auth-js` does export the class, and `@auth0/auth0-api-js` re-exports two of its siblings, `MissingClientAuthError` and `TokenExchangeError`, but not this one.

`isConnectionExchangeError()` exists so that gap stays out of your code. It narrows to `ConnectionExchangeError`, which gives you `code`, `message` and the optional `cause`, and it owns the code string in one place. `@auth0/auth0-auth-js` has deprecated `TokenForConnectionError` as of its v1.2.0 and plans to remove it in v2.0 in favour of `TokenExchangeError`, so the code this call throws is expected to change to `token_exchange_error`. When it does, the guard widens here and your `catch` block keeps working. Comparing `error.code` inline instead would leave you to find every call site yourself.

### Exchanging an external token for an Auth0 token

The two sections above start from a token Auth0 issued. This one starts from a token it did not. A legacy session, a partner service, or an MCP server holds some other credential, and you want an Auth0 access token for the same user. You configure a **Token Exchange Profile** in Auth0 that says how to validate that token type and which user it maps to, then hand the token over. This is [Custom Token Exchange](https://auth0.com/docs/authenticate/custom-token-exchange), also built on RFC 8693.

#### Prerequisites for Custom Token Exchange

- Configure `clientId` together with either `clientSecret` or `clientAssertionSigningKey`. Custom Token Exchange in Early Access does allow public clients, but this SDK path requires client authentication.
- Turn Custom Token Exchange on for that client. **It is off by default**, and there is no Dashboard toggle: set `token_exchange.allow_any_profile_of_type` through the Management API, on [Create a Client](https://auth0.com/docs/api/management/v2/clients/post-clients) or [Update a Client](https://auth0.com/docs/api/management/v2/clients/patch-clients-by-id).

  ```json
  {
    "token_exchange": {
      "allow_any_profile_of_type": ["custom_authentication"]
    }
  }
  ```

- Mark that application **first party** and **OIDC Conformant**, under **Applications > Advanced Settings > OAuth**. Both are required.
- Enable the connection you want to use with Custom Token Exchange for that application.
- Create a Token Exchange Profile in your tenant with a `subject_token_type` that matches what you pass, a `type` of `custom_authentication`, plus the action that validates the incoming token and resolves the user.
- Own the namespace you use for `subjectTokenType`, such as `urn:acme:legacy-token` or `http://acme.com/mcp-token`.
- Enable **Allow Skipping User Consent** on the API named by `audience`. Consent cannot be collected in a non-interactive flow.

> [!NOTE]
> Custom Token Exchange is in Early Access, on the B2C Professional, B2B Professional and Enterprise plans. Ask Auth0 support to enable it for your tenant.

> [!IMPORTANT]
> Miss the `allow_any_profile_of_type` step and the call fails as `token_exchange_error`, the same code you get for a profile that does not match. Rule that step out before going to look for a bug in your profile or action.

```ts
app.post('/session/upgrade', async (req, res) => {
  const result = await req.auth0.client.getTokenByExchangeProfile(req.body.legacyToken, {
    subjectTokenType: 'urn:acme:legacy-token',
    audience: 'https://api.example.com',
    scope: 'read:data',
  });

  res.json({ accessToken: result.accessToken, expiresAt: result.expiresAt });
});
```

There is no `requiresAuth()` on that route, and that is deliberate. There is no Auth0 token yet, which is the entire reason for the call. The subject token is the first argument, matching `getTokenOnBehalfOf()`.

> [!IMPORTANT]
> This is the one exchange where reading the subject token from the request is correct. The [warning above](#exchanging-a-different-token) about never taking a subject token from the request body applies to On-Behalf-Of, where the subject must be a token your API verified. Here the Token Exchange Profile is what validates the token, server side at Auth0, and a token it does not recognise is rejected. What you are responsible for is everything around it: this route mints Auth0 tokens for whoever can present a valid legacy credential, so rate limit it, log it, and keep the profile's validation strict.

Alongside `accessToken` and `expiresAt`, the result carries `scope`, `tokenType` and `issuedTokenType` when the tenant returns them. `TokenExchangeProfileResult` also declares `idToken` and `refreshToken`, which Custom Token Exchange can issue depending on your profile, your action and the scopes you ask for. This is the only one of the three methods whose result can hold either: On-Behalf-Of and Token Vault return access token fields only.

> [!CAUTION]
> Return named fields rather than the result object. `res.json(result)` on this route would forward whatever came back to a caller your API never authenticated, and that can include a refresh token, which is long lived and mints new access tokens on demand. The example above picks the two fields it means, which is the habit to copy.
>
> Do not add `offline_access` to the `scope` on a route like this one either. That is the switch that turns a refresh token from something the tenant might return into something you asked for, on behalf of a caller you have not authenticated.

Pass `requestedTokenType` to ask for something other than an access token, and `organization` to exchange inside an organization context. `organization` takes either an ID (`org_abc123`) or a name (`acme`), and a blank string is rejected before the call.

> [!WARNING]
> The `organization` check only runs when the exchange returns an ID token. `@auth0/auth0-auth-js` reads `org_id` or `org_name` from that ID token and throws on a mismatch, but skips the check entirely when there is no ID token to read. The example above asks for `scope: 'read:data'`, so nothing would be checked. Add `openid` to the scope if you want the check enforced, or verify the `org_id` claim on the returned access token yourself. Either way, do not read a call that did not throw as proof the organization was applied.

> [!NOTE]
> Some namespaces are reserved and the tenant rejects them: `http://auth0.com`, `https://auth0.com`, `http://okta.com`, `https://okta.com`, `urn:ietf`, `urn:auth0` and `urn:okta`. Nothing in the SDK checks this locally, so a reserved prefix looks fine until the call fails.

#### Handling a failed profile exchange

Same shape as [Handling a failed exchange](#handling-a-failed-exchange), and easier than Token Vault. There is no unexported class in the way of the two ordinary failures: both `MissingClientAuthError` and `TokenExchangeError` are re-exported here, so `instanceof` works for each. Only the organization check has no class you can catch.

| `error.code` | What happened |
| --- | --- |
| `missing_client_auth_error` | No client credentials, or a `clientId` without a secret or assertion key. A configuration bug. |
| `token_exchange_error` | Custom Token Exchange is not enabled on the client, no profile matches `subjectTokenType`, the profile's action rejected the token, or the subject token was missing, blank or untrimmed. |
| `organization_validation_error` | A blank `organization`, or an ID token naming a different one. See the note below. |

`error.cause` separates a local failure from a tenant one, as it does for Token Vault. A bad subject token is caught before the request goes out, so it has no `cause`. A profile that does not match, or an action that rejected the token, comes back with one.

`OrganizationValidationError` is the one class here you cannot catch by type. `@auth0/auth0-auth-js` exports it, but `@auth0/auth0-api-js` does not pass it through, so it does not reach this package either. That is an upstream gap being tracked, not a decision, which is why this package ships no guard for it: check `error.code === 'organization_validation_error'` for now and switch to `instanceof` once the re-export lands. Contrast `isConnectionExchangeError()`, which exists because the class it narrows to is being renamed upstream, so no amount of waiting produces a stable one to catch.

Read `error.cause?.error_description` into your logs and keep it out of the response. It describes your tenant setup, and this route is reachable by whoever holds the external token.

## Personal Agents (Poppy)

A Personal Agent is software that acts for a user. It signs a `Poppy-Session` header on every request to your API, and once its user has signed in, it also sends an access token. This section shows how to serve such agents with this SDK, as the [Poppy (Personal Agent Protocol) 0.3 specification](https://personalagentprotocol.org/docs/0.3/spec) describes. The support is a beta, so the SDK's API can change before it is final. The [Express API example with Personal Agents](../../examples/example-express-api-poppy) puts it all in a small shop API, with tests that need no Auth0 tenant.

### What changes when you turn it on

| With `verifySession: true` | `requiresAuth()` | `requiresAuth({ scopes })` | `requiresAuth({ poppy: { requireSession: true } })` |
| --- | --- | --- | --- |
| No credentials | 401 | 401 | 400 `invalid_session` |
| Session only (signed out) | 401 | 401 with the sign-in challenge | passes, `poppy` set |
| Access token only | passes | passes, or 403 | 400 `invalid_session`, unless the token carries a Session |
| Session and access token | passes, `poppy` set | passes or 403, `poppy` set | passes, `poppy` set |

A Poppy Session, or Session for short, is the `Poppy-Session` header after the SDK has verified it. An agent whose user has not signed in sends a Session only. Once the user has signed in, the agent sends an access token too. In the table, "passes" means that your route runs, and "`poppy` set" means that `req.auth0.poppy` holds the verified Session. `req.auth0.user` holds the claims of the access token whenever there is one. The sign-in challenge is a 401 whose `WWW-Authenticate` headers name the `scopes` of the route, so that the agent knows what to sign its user in for.

A Session alone never opens a route that does not set `requireSession`, so turning on `verifySession` does not open the routes you already have. A route with both `scopes` and `requireSession` gives a Session alone the sign-in challenge.

> [!IMPORTANT]
> Set `verifySession: true`. It is `false` by default, and then a route that does not set `requireSession` ignores the `Poppy-Session` header. The SDK does not verify it, so a forged header is not caught.

Turning on `poppy` also changes how your existing `requiresAuth()` routes answer errors, so check any client that reads them. Without `poppy`, a bad token gets one `Bearer` challenge and a JSON body, and an `Authorization: Basic` header gets the bare 401. On every `requiresAuth()` route of the router:

- DPoP-bound tokens work.
- Access-token errors are `WWW-Authenticate` challenges for both schemes, `Bearer` and `DPoP`, with no JSON body, except the 403 for a missing scope.
- An `Authorization` header that is not one `Bearer` or `DPoP` credential, such as `Basic`, is refused with challenges for both schemes.
- A `Poppy-Session` header that fails verification gets 400 `invalid_session`, even with a good token.
- A request with no credentials gets the same 401 as without `poppy`, except on a `requireSession` route, where it gets 400 `invalid_session`.

[Error responses](#error-responses) lists every answer.

What the SDK does not do:

- It does no rate limiting (see [Production notes](#production-notes)).
- It keeps no store of used Session JWT `jti`s, so it cannot refuse a reused one, as [spec 5.3](https://personalagentprotocol.org/docs/0.3/spec#session-verification) allows. Within the `iatWindow` option (60 seconds by default), a copied header works again for the same method and URL, so make a route that changes something safe to repeat.
- It keeps no Session records unless you pass a store (see [Session records](#session-records)).
- It checks no Sessions on routes without `requiresAuth()`.
- `scopesInclude()` and the claim middlewares still read only `req.auth0.user` (see [Protect routes for agents](#protect-routes-for-agents)).

### Configure the router

Configure the router once, where you call `createAuth0Api()`. The SDK needs your Auth0 issuer, the public address of your API and, ideally, the agents you accept. All three come from one file.

**The file.** `auth0-poppy.json` is the config file that the Auth0 CLI writes for your API. You can also write it by hand. The SDK reads these fields and ignores the rest:

```json
{
  "issuer": "https://your-tenant.auth0.com/",
  "apis": [{ "identifier": "https://api.example.com", "public_origin": "https://api.example.com" }],
  "agents": ["https://agent.example/agent.json"]
}
```

- `issuer` is the issuer of your Auth0 `domain`, with the trailing slash.
- `apis[].identifier` must equal the `audience` of the router.
- `apis[].public_origin` is the `https` address that agents call, with no path. It is required unless you set `baseUrl`.
- `agents` lists the agents you accept. It is optional (see [Registered agents](#registered-agents)).

**Where and when it is read.** `createAuth0Api()` takes the config from `poppy.config` if you pass one, then from the file at `poppy.configPath`, then from `auth0-poppy.json` in `process.cwd()`. It reads the file once, when it runs, so a change to the file needs a restart. `configPath` is a path, absolute or relative to `process.cwd()`, or a `URL` object:

```ts
import { createAuth0Api } from '@auth0/auth0-express-api';

app.use(
  createAuth0Api({
    domain: 'your-tenant.auth0.com',
    audience: 'https://api.example.com',
    // The file that sits next to this module, whatever folder the app starts in.
    poppy: { verifySession: true, configPath: new URL('./auth0-poppy.json', import.meta.url) },
  })
);
```

To load the file yourself, or to build the object in code, pass `config` instead. Then no file is read:

```ts
import { createAuth0Api } from '@auth0/auth0-express-api';
import type { PoppyConfig } from '@auth0/auth0-express-api';

const config: PoppyConfig = {
  issuer: 'https://your-tenant.auth0.com/',
  apis: [{ identifier: 'https://api.example.com', public_origin: 'https://api.example.com' }],
  agents: ['https://agent.example/agent.json'],
};

app.use(
  createAuth0Api({
    domain: 'your-tenant.auth0.com',
    audience: 'https://api.example.com',
    poppy: { verifySession: true, config },
  })
);
```

**Startup errors.** `createAuth0Api()` throws when the file cannot be read, is not valid JSON, or holds a value that does not fit, such as an `issuer` that is not the one of your `domain`. The app does not start, so a wrong file never serves a request. The error is an `InvalidConfigurationError` of `@auth0/auth0-api-js`, a class that this package does not export, and its message starts with `Invalid poppy configuration:`. For example, when the `audience` is not the `identifier` of any entry in `apis`:

```text
Invalid poppy configuration: "config.apis" has no entry with the identifier "https://api.example.com", the audience of this client. The identifier must equal the audience exactly. The entries have the identifiers "https://other.example".
```

A read or JSON failure names the path of the file in its message, and its `cause` holds the underlying error, which for a JSON error can include a short fragment of the file (about 20 characters), so do not log `cause` where the content of the file is sensitive.

**Options.** All of them are optional. `Auth0ApiPoppyOptions` is the type of the `poppy` option.

| Option | Default | What it does |
| --- | --- | --- |
| `config` | the parsed file at `configPath` | The parsed `auth0-poppy.json`. When set, no file is read. |
| `configPath` | `auth0-poppy.json` in `process.cwd()` | Where the file is: a path, or a `URL` object. Ignored when `config` is set. |
| `verifySession` | `false` (use `true`) | Verifies the `Poppy-Session` header on every `requiresAuth()` route. When `false`, a route ignores the header unless it sets `requireSession`. |
| `sessionStore` | none (use one) | A `PoppySessionStore`. With one, the SDK checks known Sessions and saves new ones. Without one, it keeps no records (see [Session records](#session-records)). |
| `agents` | the `agents` of the file, or no list | The agents you accept, as the URL of each one's client metadata (see [Registered agents](#registered-agents)). |
| `baseUrl` | the `public_origin` for your `audience` | The public origin of your API, such as `https://api.example.com`. It takes the place of the one in the file. |
| `iatWindow` | `60` | How far the `iat` of a Session JWT may be from now, in seconds, in both directions. |
| `agentClientIdClaims` | `['client_id', 'azp']` | The claims of the access token that name the agent it was issued to. The first one that is a string is used. |
| `agentMetadata.fetch` | the `customFetch` of the router, then the global `fetch` | The `fetch` for the requests to agent hosts. A `customFetch` that adds credentials or rewrites hosts sees the agent URLs too, so set this if yours does. |
| `agentMetadata.timeoutMs` | `5000` | The time limit for each of those requests, in milliseconds. |
| `agentMetadata.maxBytes` | `65536` | The size limit for each response body, in bytes. |
| `agentMetadata.cache` | `{ ttl: 600, maxEntries: 100 }` | How long (`ttl`, in seconds) and for how many agents good metadata and keys are kept. |
| `agentMetadata.allowPrivateAddresses` | `false` | Accepts agents on `localhost` and on private addresses. For local development only. |

**Proxies.** An agent signs the public address of your API, but behind a proxy or a gateway your server sees another one. So the SDK compares the `htu` of a Session JWT, and of a DPoP proof, which is the URL that the agent signed, with `public_origin` (or `baseUrl`) plus the path of `req.originalUrl`. The query is ignored, and the path includes the place where you mount the router. `Host`, `X-Forwarded-*` and `trust proxy` do not matter. A gateway that strips a path prefix breaks every Session: the agent signs `/api/orders`, Express sees `/orders`, and the check fails. Make the gateway keep the prefix.

### Protect routes for agents

Mark each route that an agent can call, so that the agent gets the right answer before and after its user has signed in.

```ts
import { createAuth0Api, requiresAuth } from '@auth0/auth0-express-api';
import type { PoppySessionStore } from '@auth0/auth0-express-api';

// Your store of Session records. See "Session records" below.
declare const sessionStore: PoppySessionStore;

app.use(
  createAuth0Api({
    domain: 'your-tenant.auth0.com',
    audience: 'https://api.example.com',
    poppy: { verifySession: true, sessionStore },
  })
);

// Carts live in memory here. A real app keeps them in its database.
const carts = new Map<string, string[]>();

// A Session alone is enough, so this works for an agent whose user has not signed in.
app.get('/cart', requiresAuth({ poppy: { requireSession: true } }), (req, res) => {
  res.json({ items: carts.get(req.auth0.poppy!.key) ?? [] });
});

// This route needs the account. A signed-out agent gets the sign-in challenge, which names `orders:write`.
app.post('/orders', requiresAuth({ scopes: 'orders:write', poppy: { requireSession: true } }), (req, res) => {
  const key = req.auth0.poppy!.key;
  const items = carts.get(key) ?? [];
  carts.delete(key);
  res.status(201).json({ account: req.auth0.user!.sub, items });
});

// This route does not use a Session. It needs an access token, as it did before.
app.get('/profile', requiresAuth(), (req, res) => {
  res.json({ account: req.auth0.user!.sub });
});
```

Put `requiresAuth()` on each route, as above. A `requiresAuth()` that you put on a router in front of `requireSession` routes answers a signed-out agent with 401 first, so the agent never reaches those routes.

The router passes a `sessionStore` because the carts are keyed by `poppy.key`. Without a store, the SDK keeps no record of a Session, so it cannot see that a known Session ID came back with another User ID ([spec 5.3, step 4](https://personalagentprotocol.org/docs/0.3/spec#session-verification)), and the new user would read the cart of the old one. See [Session records](#session-records).

Which one to use:

- A route that reads `req.auth0.poppy` sets `requireSession`. [Spec 5.3](https://personalagentprotocol.org/docs/0.3/spec#session-verification) requires an API to reject a request without the Session header when handling it depends on Session claims. A request without a verified Session never reaches such a route, and a Session alone is enough, so it also works for an agent whose user has not signed in.
- A route that needs the account of the user names its `scopes`. A signed-out agent then gets the sign-in challenge, which names them. The agent signs its user in for those scopes and sends the request again. On a router with `poppy`, a `scopes` string is split on spaces (`'a b'` means two scopes), but on a router without `poppy` it is still matched as one whole string. On a router with `poppy`, a `scopes` value that is not empty but names no scope, such as `' '` or `['']`, is refused with the 500 of the last row of [Error responses](#error-responses), and never treated as "no scope". `''` and `[]` do mean no scope.
- A route with neither needs an access token, as before.

`req.auth0.poppy` is a `PoppySession`:

- `key` is an opaque key that is unique for each agent and Session ID. Key your Session data by it.
- `sessionId` is the Session ID (`sid`) that the agent chose. Two agents can pick the same one.
- `userId` is the User ID that the agent gave its user for your API. It is pseudonymous, and it is not the account. The account is `req.auth0.user.sub`.
- `agent.cimdUrl` is the URL of the client metadata of the agent, which is its `client_id`.
- `agent.poppyAgentId` is the Agent ID, when the agent sent one.
- `state` is `'signed_in'` when the request has a verified access token, and `'signed_out'` when it has none.
- `source` is where the Session came from: `'header'` for the `Poppy-Session` header, and `'token'` for the `act` claim of a web app's access token, whose `poppy_*` members are beta claims that Auth0 issues.

`req.auth0.user` is set only when the request has a verified access token. A token is always there on a route that has `scopes` or does not set `requireSession`. On a `requireSession` route without `scopes`, a Session alone passes, so check `req.auth0.user` before you use it.

**Keys.** Key your data by `req.auth0.poppy.key`, never by `sessionId` alone, because two agents can pick the same Session ID. The key stays the same when the user signs in, so a cart that an agent filled while signed out is still there afterwards. Pass a `sessionStore` as well, or two users of one Session ID share the data under one key.

**Limits.** `scopesInclude()` and the claim middlewares read only `req.auth0.user`, which exists only with an access token. After a `requireSession` route, a signed-out agent gets 403 `insufficient_scope` from `scopesInclude()`, and 401 `invalid_token` from the claim middlewares. So put the scopes of an agent route in `requiresAuth({ scopes })`, where a signed-out agent gets the sign-in challenge.

### Error responses

`requiresAuth()` answers a failed check itself, and your route does not run. [Spec section 7](https://personalagentprotocol.org/docs/0.3/spec#apis) defines most of these answers. In the default DPoP mode, which this SDK uses, a request may use `Bearer` or `DPoP`, so a row with two `WWW-Authenticate` headers has one for each scheme. This is what an agent sees:

| Case | Status | Headers and body |
| --- | --- | --- |
| No credentials | 401, or 400 `invalid_session` on a `requireSession` route | For the 401: `WWW-Authenticate: Bearer`, no body. For the 400, see the `invalid_session` row. |
| The sign-in challenge: a Session and no access token, on a route with `scopes` | 401 | Two `WWW-Authenticate` headers that name the scopes: `Bearer realm="api", scope="orders:write"` and `DPoP scope="orders:write", algs="ES256"`. No error code, no body. |
| A missing scope | 403 | `WWW-Authenticate: Bearer error="insufficient_scope", error_description="Insufficient scopes", scope="orders:write"`, and the JSON body `{"error":"insufficient_scope","error_description":"Insufficient scopes"}`. It names only the `Bearer` scheme, also for a DPoP-bound token. |
| An invalid token, such as an expired one or a DPoP-bound token sent as `Bearer` | 401 | Two `WWW-Authenticate` headers, one for `Bearer` and one for `DPoP`. The `error="invalid_token"` is on the header of the scheme the agent used: the `Bearer` one for a token sent as `Bearer`, and the `DPoP` one for a token sent as `DPoP`. No body. |
| A token that the SDK cannot verify because it cannot fetch the discovery document or the keys of your tenant | 401 | The same as for an invalid token: for a token sent as `Bearer`, the `Bearer` header has `error="invalid_token"`. No body. |
| An `Authorization` header with a scheme other than `Bearer` or `DPoP` (such as `Basic`), or with a token and no scheme | 400 | Two `WWW-Authenticate` headers, with no error code. No body. |
| An `Authorization` header with a comma in its value, such as `Bearer a, Bearer b` | 400 | Two `WWW-Authenticate` headers. The `Bearer` one has `error="invalid_request"`. No body. |
| `Bearer` or `DPoP` with no token | 401 | Two `WWW-Authenticate` headers, with no error code. No body. |
| A bad DPoP proof | 400 | Two `WWW-Authenticate` headers. The `DPoP` one has `error="invalid_dpop_proof"`. No body. |
| `invalid_session` | 400 | The JSON body `{"error":"invalid_session","error_description":"..."}`. No `WWW-Authenticate`. |
| `session_ended` | 400 | The JSON body `{"error":"session_ended","error_description":"..."}`. |
| `temporarily_unavailable` | 503 | `Retry-After: 30`, and the JSON body `{"error":"temporarily_unavailable","error_description":"..."}`. |
| Anything else | 500 | The SDK sends nothing. It calls `next(error)` with the message `The request could not be verified.`, a `status` of 500, and the original error as `cause`. Your error handler answers. |

- `invalid_session` means that a Session check failed. The `error_description` says which one, for you, so do not match on its text. A new Session does not fix it, so the agent stops sending the request until it fixes the cause.
- `session_ended` means that the Session ended, or that your code refused an account change in it. The agent starts a new Session and sends the request again, once.
- `temporarily_unavailable` means that the SDK cannot fetch the metadata or the keys of the agent right now. The request is never accepted, and the agent tries again later. The [spec](https://personalagentprotocol.org/docs/0.3/spec#apis) defines no answer for this case, so the 503 is the choice of the SDK. While the SDK remembers the failure, `Retry-After` counts down from 30.
- For anything else, such as a Session store that throws, or a `scopes` option that is not empty but names no scope, log the `cause` and keep it out of the response.

**Errors your handlers throw.** Some Session errors come from your own code (see [Session records](#session-records)). Register an error handler after your routes to answer them. `toHttpErrorResponse()` gives an `HttpErrorResponse`, the status, the headers and the body, for an error of this SDK, and `undefined` for any other error, which goes on to `next(error)`:

```ts
import type { ErrorRequestHandler } from 'express';
import { toHttpErrorResponse } from '@auth0/auth0-express-api';

export const poppyErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  const failure = toHttpErrorResponse(error);
  if (!failure) {
    next(error); // Not an error of this SDK: let Express answer 500.
    return;
  }

  res.status(failure.status).set(failure.headers);
  if (failure.body) {
    res.json(failure.body);
  } else {
    res.end();
  }
};

// Register it after your routes.
app.use(poppyErrorHandler);
```

### Session records

A Session is more than a verified header. [Spec 5.3](https://personalagentprotocol.org/docs/0.3/spec#session-verification), step 4, says that an unknown Session ID starts a signed-out Session, and that a known one must come with the same User ID and Agent ID as before. [Spec 5.5](https://personalagentprotocol.org/docs/0.3/spec#ending-sessions) lets you remember ended Sessions and answer them with `session_ended`. Both need a record of each Session. Without records, the SDK verifies the header and returns the Session, and nothing more: it cannot tell that the user of a Session changed, or that the Session ended. Keep the records in a store that the SDK calls, or run the two checks yourself.

**The store contract.** Extend `PoppySessionStore` on top of your own storage, and pass an instance as the `sessionStore` option of `poppy`. The SDK has no built-in store, no expiry and no clean-up. The class has two methods:

- `get(key)` resolves to the record stored under `key`, or to `undefined` (or `null`) when the key is unknown.
- `set(key, record)` inserts only if absent, and resolves to the record that is stored afterwards: the new one, or the one that was already there. It never overwrites. Two first requests of one Session can arrive together, and the second one must compare itself with the record of the first.

A record is `{ userId, poppyAgentId?, ended? }`, and any truthy `ended` ends the Session. The agent chooses `userId` and `poppyAgentId`, and the SDK limits them only by the 16,384 characters of the whole Session JWT, so use columns that fit that. If `get` or `set` throws, the request fails with a 500 and no Session is accepted (see the last row of [Error responses](#error-responses)).

**A store backed by a `Map`.** This one is complete, but it is a sample: a `Map` lives in one process, never forgets a Session, and so grows without limit and never expires. Use it for tests and demos. A real app keeps the records in its database, as the SQL store below does, and shares them between its servers. [The example app](../../examples/example-express-api-poppy/src/memory-store.ts) has the same store, with tests.

Call `store.end(req.auth0.poppy!.key)` when a Session is over, for example when a checkout completes: later requests with that Session ID get `session_ended`, and the agent starts a new Session. If the `end` of your store is async, as in the SQL store below, `await` it: `await store.end(req.auth0.poppy!.key)`. Otherwise the next request can arrive before the Session is ended.

```ts
// memory-store.ts
import { PoppySessionStore } from '@auth0/auth0-express-api';
import type { PoppySessionRecord } from '@auth0/auth0-express-api';

/**
 * Keeps Session records in memory, for a sample. `set` follows the two rules of the store contract: it inserts only if
 * the key is absent, and it resolves to the record that is stored afterwards. A `Map` never forgets a Session, so it
 * grows without limit. A real app keeps the records in its database.
 */
export class MemoryPoppySessionStore extends PoppySessionStore {
  readonly #records = new Map<string, PoppySessionRecord>();

  async get(key: string): Promise<PoppySessionRecord | undefined> {
    return this.#records.get(key);
  }

  // There is no await between the check and the write, so two requests of a new Session that set one key together
  // store one record.
  async set(key: string, record: PoppySessionRecord): Promise<PoppySessionRecord> {
    const existing = this.#records.get(key);
    if (existing) {
      return existing;
    }
    this.#records.set(key, record);
    return record;
  }

  // Ends a Session: later requests with its Session ID are refused with `session_ended`.
  end(key: string): void {
    const record = this.#records.get(key);
    if (record) {
      this.#records.set(key, { ...record, ended: true });
    }
  }
}
```

To see it work, run this next to the file. A second `set` for a key returns the first record, and `end` marks it as ended:

```ts
import { MemoryPoppySessionStore } from './memory-store.js';

const store = new MemoryPoppySessionStore();

const first = await store.set('key_1', { userId: 'usr_1' });
const second = await store.set('key_1', { userId: 'usr_2' });
console.log(second === first); // true: the first record is kept

store.end('key_1');
console.log(await store.get('key_1'));
```

It prints:

```text
true
{ userId: 'usr_1', ended: true }
```

**A store backed by SQL.** `set` is the part to get right: insert if absent, then read the row back, so that two first requests of one Session compare with the same record. The insert must be one statement: with a SELECT followed by an INSERT, two first requests can both find no row, and then the second insert fails on the duplicate key, or the two requests keep different records, depending on your schema. Run `get` and the read-back on the primary database, or with another consistent read: a replica that lags can miss the row, and then `set` must throw, because a made-up record would let the SDK accept the Session without comparing it with the stored one. `Query` stands for your database client, so no library is assumed. The `$1` placeholders are PostgreSQL style. SQLite drivers use `?`. `ON CONFLICT ... DO NOTHING` is the form that PostgreSQL and SQLite use. Use the insert-if-absent statement of your own database.

```sql
CREATE TABLE poppy_sessions (
  key      TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL,
  agent_id TEXT,
  ended    BOOLEAN NOT NULL DEFAULT FALSE
);
```

```ts
import { PoppySessionStore } from '@auth0/auth0-express-api';
import type { PoppySessionRecord } from '@auth0/auth0-express-api';

// Your database client: runs `sql` with `params` and returns the rows.
type Query = <Row>(sql: string, params: unknown[]) => Promise<Row[]>;

interface SessionRow {
  user_id: string;
  agent_id: string | null;
  ended: boolean | number;
}

const SELECT = 'SELECT user_id, agent_id, ended FROM poppy_sessions WHERE key = $1';

function toRecord(row: SessionRow): PoppySessionRecord {
  return { userId: row.user_id, poppyAgentId: row.agent_id ?? undefined, ended: Boolean(row.ended) };
}

export class SqlPoppySessionStore extends PoppySessionStore {
  constructor(private readonly query: Query) {
    super();
  }

  async get(key: string): Promise<PoppySessionRecord | undefined> {
    const [row] = await this.query<SessionRow>(SELECT, [key]);
    return row && toRecord(row);
  }

  async set(key: string, record: PoppySessionRecord): Promise<PoppySessionRecord> {
    // Insert only if absent. Two first requests of a Session can arrive together.
    await this.query(
      'INSERT INTO poppy_sessions (key, user_id, agent_id) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
      [key, record.userId, record.poppyAgentId ?? null]
    );
    // Read back what is stored: the first request wins, and both requests compare with its row.
    const [row] = await this.query<SessionRow>(SELECT, [key]);
    if (!row) {
      // Never answer with `record` here. The request fails, and the SDK accepts no Session.
      throw new Error('The Session record was not found after the insert.');
    }
    return toRecord(row);
  }

  // Ends a Session: later requests with its Session ID are refused with `session_ended`.
  // It is async, so call it as `await store.end(key)`.
  async end(key: string): Promise<void> {
    await this.query('UPDATE poppy_sessions SET ended = TRUE WHERE key = $1', [key]);
  }
}
```

**Without a store.** If your Sessions already live in your own database, run the two checks yourself, right after `requiresAuth()` on a route that sets `requireSession`. They are the checks that a store runs, with the same errors. Throw `new InvalidSessionError('session_mismatch')` or `new SessionEndedError()` from the middleware or the route, and the error handler from [Error responses](#error-responses) answers it with 400 `invalid_session` or 400 `session_ended`.

```ts
import type { RequestHandler } from 'express';
import { InvalidSessionError, SessionEndedError, requiresAuth } from '@auth0/auth0-express-api';
import type { PoppySessionRecord } from '@auth0/auth0-express-api';

// Your own table of Sessions, keyed by `poppy.key`. A Map keeps the sample short, but it never forgets a Session:
// use your database, and make the insert atomic.
const sessions = new Map<string, PoppySessionRecord>();

export const checkSession: RequestHandler = (req, _res, next) => {
  const poppy = req.auth0.poppy!;
  const known = sessions.get(poppy.key);

  if (!known) {
    // A new Session ID starts a signed-out Session.
    sessions.set(poppy.key, { userId: poppy.userId, poppyAgentId: poppy.agent.poppyAgentId });
  } else if (known.ended) {
    throw new SessionEndedError();
  } else if (known.userId !== poppy.userId || known.poppyAgentId !== poppy.agent.poppyAgentId) {
    // A known Session ID continues its Session, and must come with the same User ID and Agent ID.
    throw new InvalidSessionError('session_mismatch');
  }

  next();
};

app.get('/cart', requiresAuth({ poppy: { requireSession: true } }), checkSession, (req, res) => {
  res.json({ state: req.auth0.poppy!.state });
});
```

In an `async` handler, an error that you throw reaches your error handler on Express 5 only. On Express 4, catch it and call `next(error)`, as [Handling a failed exchange](#handling-a-failed-exchange) explains.

**Account changes.** [Spec 5.4](https://personalagentprotocol.org/docs/0.3/spec#sign-in) lets you refuse a request whose access token is for another account than the one its Session used before. The SDK does not track accounts. Keep the account that a Session first used in your own table, and throw `SessionEndedError` when it changes. The agent then starts a new Session for the other account.

```ts
import type { RequestHandler } from 'express';
import { SessionEndedError } from '@auth0/auth0-express-api';

// The account each Session first used, in your own table, keyed by `poppy.key`. A Map keeps the sample short: use
// your database.
const accountOfSession = new Map<string, string>();

// Put it after `requiresAuth()`.
export const refuseAccountChange: RequestHandler = (req, _res, next) => {
  const account = req.auth0.user?.sub;
  const poppy = req.auth0.poppy;
  if (!account || !poppy) {
    next(); // Signed out, or no Session: there is nothing to compare.
    return;
  }

  const first = accountOfSession.get(poppy.key);
  if (first === undefined) {
    accountOfSession.set(poppy.key, account);
  } else if (first !== account) {
    // The agent starts a new Session and sends the request again, once.
    throw new SessionEndedError('This Session was used with another account. Start a new Session.');
  }

  next();
};
```

### Registered agents

Say which agents you accept, so that your API fetches the metadata only of agents you know. Set `agents`, or use the `agents` of `auth0-poppy.json`. Each agent is the URL of its client metadata, which is its `client_id`. The `agents` option takes the place of the list in the file.

```ts
import { createAuth0Api } from '@auth0/auth0-express-api';

app.use(
  createAuth0Api({
    domain: 'your-tenant.auth0.com',
    audience: 'https://api.example.com',
    poppy: {
      verifySession: true,
      // The client metadata URL (the `client_id`) of each agent you accept.
      agents: ['https://agent.example/agent.json', 'https://assistant.example/client.json'],
    },
  })
);
```

With a list:

- A Session from an agent that is not on the list gets 400 `invalid_session`, before the SDK fetches anything from that agent.
- While Session checks are on, the access token of a listed agent gets 400 `invalid_session` when it comes without the `Poppy-Session` header, because a registered agent sends the header on every request ([spec 5.2](https://personalagentprotocol.org/docs/0.3/spec#session-header)). The agent of a token is named by its `client_id` or `azp` claim (`agentClientIdClaims`).
- `agents` does not filter a Session that comes from the `act` claim of a web app's access token (`source: 'token'`). If you need that, check `req.auth0.poppy.agent.cimdUrl` yourself.

Use a list in production. Without one, any public HTTPS agent URL in a Session JWT makes your API fetch that agent's metadata.

### Test your routes

`createTestAgent()` is a fake Personal Agent for tests. It makes its own keys, signs real `Poppy-Session` headers, and serves its own metadata through `agent.fetch`, with no network. Pass that function as `agentMetadata.fetch`, and your routes verify its requests the way they verify a real agent's. Import it from `@auth0/auth0-express-api/testing`, in tests only.

> [!NOTE]
> `@auth0/auth0-express-api/testing` is an entry of the `exports` map of the package, and `package.json` has a `typesVersions` entry for it. So TypeScript finds its types when `moduleResolution` is `node10` (the classic `node` setting), `node16`, `nodenext` or `bundler`.

The test below uses vitest and supertest. It sends one signed-out request, which passes, and one with `defect: 'expired_delegation'`, which gets 400 `invalid_session`. Create the agent and the router together in each test, because the router caches the keys of an agent by its URL, and every agent makes new keys.

```ts
import { describe, expect, test } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuth0Api, requiresAuth } from '@auth0/auth0-express-api';
import { createTestAgent } from '@auth0/auth0-express-api/testing';

const ISSUER = 'https://your-tenant.auth0.com/';
const ORIGIN = 'https://api.example.com';
const config = { issuer: ISSUER, apis: [{ identifier: ORIGIN, public_origin: ORIGIN }] };

async function setup() {
  const agent = await createTestAgent();

  const app = express();
  app.use(
    createAuth0Api({
      domain: 'your-tenant.auth0.com',
      audience: ORIGIN,
      poppy: { config, verifySession: true, agentMetadata: { fetch: agent.fetch } },
    })
  );
  app.get('/cart', requiresAuth({ poppy: { requireSession: true } }), (req, res) => {
    res.json({ state: req.auth0.poppy!.state });
  });

  return { agent, app };
}

describe('GET /cart, signed out', () => {
  test('accepts a valid Session', async () => {
    const { agent, app } = await setup();
    const sessionJwt = await agent.createSessionJwt({ aud: ISSUER, htm: 'GET', htu: `${ORIGIN}/cart` });

    const res = await request(app).get('/cart').set('Poppy-Session', sessionJwt);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'signed_out' });
  });

  test('refuses an expired delegation with invalid_session', async () => {
    const { agent, app } = await setup();
    const sessionJwt = await agent.createSessionJwt({
      aud: ISSUER,
      htm: 'GET',
      htu: `${ORIGIN}/cart`,
      defect: 'expired_delegation',
    });

    const res = await request(app).get('/cart').set('Poppy-Session', sessionJwt);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_session');
  });
});
```

A signed-out request never calls Auth0, so these tests need no Auth0 mocks. A signed-in test also sends an access token, and the router verifies it against the discovery document and the keys of your tenant, so mock those two requests. Pass the token as `accessToken` to `createSessionJwt()`, so that the Session vouches for it. [The tests of the example app](../../examples/example-express-api-poppy/src/app.spec.ts) show how. The `TestSessionJwtDefect` type lists the other defects that `createSessionJwt()` can add.

### Production notes

- **Keep Session records** in a store that all instances share, and make `set` atomic in the database: pass a `sessionStore`, or run the two checks yourself (see [Session records](#session-records)). Two requests of a new Session can reach two instances at the same time. Without records, the SDK cannot see that a known Session ID came back with another User ID.
- **Rate limit**, because the SDK does not. Limit by client IP before `requiresAuth()`, and per agent after it, keyed by the verified `req.auth0.poppy.agent.cimdUrl`. Answer a request over the limit with 429 and a `Retry-After` header ([spec 5.6](https://personalagentprotocol.org/docs/0.3/spec#sending-requests)).
- **`trust proxy`** matters only for `req.ip`, which your IP limit reads. The Session checks never use `Host` or `X-Forwarded-*`.
- **Refuse a request with two `Authorization` lines.** Node keeps the first `Authorization` line of a request and drops the others, so the SDK sees only one. Use `http.createServer({ joinDuplicateHeaders: true }, app).listen(port)` instead of `app.listen(port)`: Node then joins the lines with a comma, and the SDK refuses the request with a 400 (see [Error responses](#error-responses)).
- **Keep an `agents` list** (see [Registered agents](#registered-agents)).
- **Deploy `auth0-poppy.json` with the app**, or set `configPath` or `config`. Without one of them the app does not start, and a change to the file needs a restart.
- **Never import `@auth0/auth0-express-api/testing` in production code.** It is for tests only.
