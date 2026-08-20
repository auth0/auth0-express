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
- Create a Token Exchange Profile in your tenant with a `subject_token_type` that matches what you pass, plus the action that validates the incoming token and resolves the user.
- Own the namespace you use for `subjectTokenType`, such as `urn:acme:legacy-token` or `http://acme.com/mcp-token`.

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

Alongside `accessToken` and `expiresAt`, the result carries `scope`, `tokenType` and `issuedTokenType` when the tenant returns them.

Pass `requestedTokenType` to ask for something other than an access token, and `organization` to exchange inside an organization context. `organization` takes either an ID (`org_abc123`) or a name (`acme`), and a blank string is rejected before the call.

> [!WARNING]
> The `organization` check only runs when the exchange returns an ID token. `@auth0/auth0-auth-js` reads `org_id` or `org_name` from that ID token and throws on a mismatch, but skips the check entirely when there is no ID token to read. Do not treat a call that did not throw as proof you got a token for the organization you asked for.

> [!NOTE]
> Some namespaces are reserved and the tenant rejects them: `http://auth0.com`, `https://auth0.com`, `http://okta.com`, `https://okta.com`, `urn:ietf`, `urn:auth0` and `urn:okta`. Nothing in the SDK checks this locally, so a reserved prefix looks fine until the call fails.

#### Handling a failed profile exchange

Same shape as [Handling a failed exchange](#handling-a-failed-exchange), and easier than Token Vault. There is no unexported class in the way of the two ordinary failures: both `MissingClientAuthError` and `TokenExchangeError` are re-exported here, so `instanceof` works for each. Only the organization check has no class you can catch.

| `error.code` | What happened |
| --- | --- |
| `missing_client_auth_error` | No client credentials, or a `clientId` without a secret or assertion key. A configuration bug. |
| `token_exchange_error` | No profile matches `subjectTokenType`, the profile's action rejected the token, or the subject token was missing, blank or untrimmed. |
| `organization_validation_error` | A blank `organization`, or an ID token naming a different one. Not exported, so check the code. |

`error.cause` separates a local failure from a tenant one, as it does for Token Vault. A bad subject token is caught before the request goes out, so it has no `cause`. A profile that does not match, or an action that rejected the token, comes back with one.

Read `error.cause?.error_description` into your logs and keep it out of the response. It describes your tenant setup, and this route is reachable by whoever holds the external token.
