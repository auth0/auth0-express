# Examples

- [Configuration](#configuration)
  - [Basic configuration](#basic-configuration)
  - [Using environment variables](#using-environment-variables)
  - [Configuring the mounted routes](#configuring-the-mounted-routes)
  - [Configuring a customFetch implementation](#configuring-a-customfetch-implementation)
  - [Dynamic Application Base URLs](#dynamic-application-base-urls)
  - [Discovery Cache](#discovery-cache)
- [The `ServerClient` instance](#the-serverclient-instance)
- [Protecting Routes](#protecting-routes)
  - [Using requiresAuth middleware](#using-requiresauth-middleware)
  - [Using custom middleware](#using-custom-middleware)
- [Authorization with Claims](#authorization-with-claims)
  - [Using claimEquals](#using-claimequals)
  - [Using claimIncludes](#using-claimincludes)
  - [Using claimCheck for custom logic](#using-claimcheck-for-custom-logic)
- [Requesting an Access Token to call an API](#requesting-an-access-token-to-call-an-api)
- [Enterprise Connect](#enterprise-connect)
  - [Starting an Enterprise Connect login](#starting-an-enterprise-connect-login)
  - [Checking Home Realm Discovery yourself](#checking-home-realm-discovery-yourself)
  - [Logging out](#logging-out)
- [Experiment Center](#experiment-center)
  - [Testing](#testing)
  - [Production usage](#production-usage)
- [Anonymous Sessions](#anonymous-sessions)
  - [Enabling anonymous sessions](#enabling-anonymous-sessions)
  - [Creating and reading a session](#creating-and-reading-a-session)
  - [Getting an access token](#getting-an-access-token)
  - [Ending the anonymous session](#ending-the-anonymous-session)
  - [Error handling](#error-handling)
  - [Merging what the visitor did before they logged in](#merging-what-the-visitor-did-before-they-logged-in)
  - [Custom store](#custom-store)
- [Multiple Custom Domains (MCD)](#multiple-custom-domains-mcd)
- [Personal Agent Protocol (Poppy)](#personal-agent-protocol-poppy)
  - [What changes when you turn on Poppy](#what-changes-when-you-turn-on-poppy)
  - [Set up Auth0 and the config file](#set-up-auth0-and-the-config-file)
  - [Scopes](#scopes)
  - [The audience of your login route](#the-audience-of-your-login-route)
  - [Serve the discovery files](#serve-the-discovery-files)
  - [Read who is driving the browser](#read-who-is-driving-the-browser)
  - [Guard pages from guests](#guard-pages-from-guests)
  - [Sign out a guest](#sign-out-a-guest)
  - [Poppy errors](#poppy-errors)
  - [Test the join without a tenant](#test-the-join-without-a-tenant)
  - [Custom guest store](#custom-guest-store)
  - [Poppy in production](#poppy-in-production)

## Configuration

### Basic configuration

Register the Auth0 Express router with your Express instance.

```ts
import express from 'express';
import { createAuth0 } from '@auth0/auth0-express';

const app = express();

app.use(createAuth0({
  domain: '<AUTH0_DOMAIN>',
  clientId: '<AUTH0_CLIENT_ID>',
  clientSecret: '<AUTH0_CLIENT_SECRET>',
  appBaseUrl: '<APP_BASE_URL>',
  sessionSecret: '<SESSION_SECRET>',
}));
```

The `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, and `AUTH0_CLIENT_SECRET` can be obtained from the [Auth0 Dashboard](https://manage.auth0.com) once you've created an application. **This application must be a `Regular Web Application`**.
The `SESSION_SECRET` is the key used to encrypt the session and transaction cookies. You can generate a secret using `openssl`:

```shell
openssl rand -hex 64
```

The `APP_BASE_URL` is the URL that your application is running on. When developing locally, this is most commonly `http://localhost:3000`.

> [!IMPORTANT]
> You will need to register the following URLs in your Auth0 Application via the [Auth0 Dashboard](https://manage.auth0.com):
>
> - Add `http://localhost:3000/auth/callback` to the list of **Allowed Callback URLs**
> - Add `http://localhost:3000` to the list of **Allowed Logout URLs**

### Using environment variables

The SDK automatically reads configuration from environment variables, making it easy to configure without hardcoding values:

```ts
import express from 'express';
import { createAuth0 } from '@auth0/auth0-express';
import 'dotenv/config'; // Optional: load from .env file

const app = express();

// Configuration is automatically read from environment variables
app.use(createAuth0());
```

Supported environment variables:
- `AUTH0_DOMAIN` - Your Auth0 domain
- `AUTH0_CLIENT_ID` - Your Auth0 application client ID
- `AUTH0_CLIENT_SECRET` - Your Auth0 application client secret (optional)
- `APP_BASE_URL` - Your application base URL
- `AUTH0_SESSION_SECRET` - Secret for session encryption
- `AUTH0_AUDIENCE` - API audience (optional)

Example `.env` file:

```env
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
APP_BASE_URL=http://localhost:3000
AUTH0_SESSION_SECRET=your_long_random_secret_here
AUTH0_AUDIENCE=https://api.example.com
```

You can also override specific values while using environment variables for others:

```ts
app.use(createAuth0({
  audience: 'https://api.example.com' // Override while using env vars for other config
}));
```

> [!NOTE]
> For migration from `express-openid-connect`, alternative environment variable names are supported: `ISSUER_BASE_URL` (for domain), `CLIENT_ID`, `CLIENT_SECRET`, `BASE_URL` and `SECRET` (for session secret). These are provided for compatibility but `AUTH0_*` prefixed names are recommended.

### Configuring the mounted routes

By default, the SDK mounts the following routes:

- `auth/login`
- `auth/callback`
- `auth/logout`
- `auth/backchannel-logout`

The SDK can also be configured not to register these routes by setting the `mountRoutes` option to `false`:

```ts
import express from 'express';
import { createAuth0 } from '@auth0/auth0-express';

const app = express();

app.use(createAuth0({
  /* ... */
  mountRoutes: false,
}));
```

### Configuring a `customFetch` implementation

The SDK allows to override the fetch implementation, used for making HTTP requests, by providing a custom implementation when registering the router:

```ts
import express from 'express';
import { createAuth0 } from '@auth0/auth0-express';

const app = express();

app.use(createAuth0({
  /* ... */
  customFetch: async (input, init) => {
    // Custom fetch implementation
  },
}));
```

### Dynamic Application Base URLs

By default the SDK uses a static `appBaseUrl` (or `APP_BASE_URL` / `BASE_URL`). For preview/deploy environments where the host is not known at startup, you can either omit it (host inference) or provide an allow-list.

#### Host inference (omit `appBaseUrl`)

```ts
import { createAuth0 } from '@auth0/auth0-express';

// APP_BASE_URL omitted; the base URL is inferred from each request's host.
app.use(createAuth0());
```

The SDK builds the base URL per request from the request protocol and host. When your app runs behind a reverse proxy (most preview platforms such as Vercel and Netlify do), enable Express's [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) setting so the forwarded `x-forwarded-proto` / `x-forwarded-host` headers are honored:

```ts
const app = express();
app.set('trust proxy', true); // or a more specific value (e.g. number of hops, subnet)

app.use(createAuth0());
```

When `trust proxy` is not enabled, the SDK ignores the `x-forwarded-*` headers and uses the connection protocol and the `Host` header — matching how `req.protocol`, `req.secure`, and the rest of Express behave. This works the same on Express 4 and 5.

#### Allow-list (recommended for production)

Provide an array of permitted base URLs. The SDK matches the incoming request origin against the list and rejects anything else:

```ts
app.use(createAuth0({
  appBaseUrl: ['https://app.example.com', 'https://myapp.vercel.app'],
}));
```

Via environment variable, use a comma-separated value:

```env
APP_BASE_URL=https://app.example.com,https://myapp.vercel.app
```

> [!IMPORTANT]
> The host comes from the request and is ultimately untrusted input. Enabling `trust proxy` only when you are genuinely behind a trusted proxy, and using the allow-list above, are your first line of defense. Auth0's **Allowed Callback URLs** are the primary safeguard: if the resolved host is not registered in your Auth0 application, Auth0 rejects the authorize request. Register every dynamic/preview host you expect.

> [!NOTE]
> When relying on dynamic base URLs (omitted `appBaseUrl`) in production (`NODE_ENV=production`), the SDK enforces a secure session cookie. Explicitly setting `sessionConfiguration.cookie.secure = false` throws `InvalidConfigurationError`.

### Discovery Cache

By default the SDK caches OIDC discovery metadata and JWKS in memory (TTL 600s, max 100 entries), delegated to `@auth0/auth0-server-js`. Cache entries are scoped per resolved Auth0 domain, so each domain keeps its own discovery/JWKS data.

```ts
app.use(createAuth0({
  // other options...
  discoveryCache: { ttl: 800, maxEntries: 200 },
}));
```

Most apps can keep the defaults. Adjust them when:

- **`maxEntries`** — raise it if one process serves more than ~100 distinct Auth0 domains within the TTL window (common in larger MCD deployments).
- **`ttl`** — raise it to reduce repeated discovery/JWKS fetches; lower it to pick up metadata/signing-key changes sooner; set `0` to effectively disable the cache.

## The `ServerClient` instance

Once the router is registered, an instance of the Auth0 `ServerClient` is available via `req.auth0.client` on the request object. This instance can be used to call any of the methods available on the `ServerClient`, such as `getUser()`, `getSession()`, and `getAccessToken()`.

For the complete list of available methods, please refer to the [@auth0/auth0-server-js SDK documentation](https://github.com/auth0/auth0-auth-js/blob/main/packages/auth0-server-js/README.md).

## Protecting Routes

### Using requiresAuth middleware

The SDK provides a `requiresAuth` middleware that automatically protects routes and handles authentication redirects:

```ts
import { requiresAuth } from '@auth0/auth0-express';

// Protect a route - redirects to login if not authenticated
app.get('/profile', requiresAuth(), async (req, res) => {
  const user = await req.auth0.client.getUser();
  res.render('profile.ejs', { name: user!.name });
});

// For API routes - returns 401 instead of redirecting
app.get('/api/me', requiresAuth(), async (req, res) => {
  const user = await req.auth0.client.getUser();
  res.json({ user });
});

// Custom return URL after login
app.get('/admin', requiresAuth({ returnTo: '/admin/dashboard' }), (req, res) => {
  res.send('Admin page');
});
```

The `requiresAuth` middleware automatically:
- Redirects HTML requests to `/auth/login` with a `returnTo` parameter
- Returns `401 Unauthorized` for API requests (those that accept JSON but not HTML)
- Preserves the original URL for post-login redirect

### Using custom middleware

You can also create custom middleware using the SDK's `getUser()` method:

```ts
async function hasUserMiddleware(req, res, next) {
  const user = await req.auth0.client.getUser();

  if (!user) {
    return res.redirect('/auth/login');
  }

  next();
}

app.get('/profile', hasUserMiddleware, async (req, res) => {
  const user = await req.auth0.client.getUser();
  res.render('profile.ejs', { name: user!.name });
});
```

> [!IMPORTANT]
> The above is to protect server-side rendering routes by the means of a session, and not API routes using a bearer token.

## Authorization with Claims

The SDK provides middleware for claim-based authorization, useful for implementing role-based access control (RBAC) and permissions.

### Using claimEquals

Check if a specific claim equals an expected value:

```ts
import { claimEquals, requiresAuth } from '@auth0/auth0-express';

// Only allow users with role 'admin'
app.get('/admin',
  requiresAuth(),
  claimEquals('role', 'admin'),
  (req, res) => {
    res.send('Admin dashboard');
  }
);

// Check a namespace claim
app.get('/internal',
  requiresAuth(),
  claimEquals('https://myapp.com/department', 'engineering'),
  (req, res) => {
    res.send('Engineering portal');
  }
);
```

By default, `claimEquals` checks the ID token claims. You can specify to check access token claims instead:

```ts
app.get('/admin',
  requiresAuth(),
  claimEquals('role', 'admin', { tokenType: 'access' }),
  (req, res) => {
    res.send('Admin dashboard');
  }
);
```

### Using claimIncludes

Check if a claim array includes a specific value, useful for permissions:

```ts
import { claimIncludes, requiresAuth } from '@auth0/auth0-express';

// Check if user has 'delete:users' permission
app.delete('/users/:id',
  requiresAuth(),
  claimIncludes('permissions', 'delete:users'),
  async (req, res) => {
    // Delete user logic
    res.json({ success: true });
  }
);

// Check for multiple permissions (user needs at least one)
app.get('/admin/users',
  requiresAuth(),
  claimIncludes('permissions', ['read:users', 'admin:all']),
  (req, res) => {
    res.render('users-list');
  }
);
```

### Using claimCheck for custom logic

For complex authorization rules, use `claimCheck` with a custom validation function:

```ts
import { claimCheck, requiresAuth } from '@auth0/auth0-express';

// Check multiple conditions
app.get('/premium',
  requiresAuth(),
  claimCheck((req, claims) => {
    return claims.subscription === 'premium' && claims.email_verified === true;
  }),
  (req, res) => {
    res.render('premium-content');
  }
);

// Check if user is in specific organization with required role
app.get('/org/:orgId/settings',
  requiresAuth(),
  claimCheck((req, claims) => {
    const orgId = req.params.orgId;
    return claims.org_id === orgId && claims.org_role === 'owner';
  }),
  (req, res) => {
    res.render('org-settings');
  }
);

// Check access token claims
app.post('/api/admin',
  requiresAuth(),
  claimCheck((req, claims) => {
    return claims.scope?.includes('admin:write');
  }, { tokenType: 'access' }),
  (req, res) => {
    res.json({ success: true });
  }
);
```

All claim middleware returns:
- `403 Forbidden` for HTML requests when authorization fails
- `403 Forbidden` with JSON error for API requests

## Requesting an Access Token to call an API

If you need to call an API on behalf of the user, you want to specify the `audience` parameter when registering the router. This will make the SDK request an access token for the specified audience when the user logs in.

```ts
app.use(createAuth0({
  domain: '<AUTH0_DOMAIN>',
  clientId: '<AUTH0_CLIENT_ID>',
  clientSecret: '<AUTH0_CLIENT_SECRET>',
  audience: '<AUTH0_AUDIENCE>',
  appBaseUrl: '<APP_BASE_URL>',
  sessionSecret: '<SESSION_SECRET>',
}));
```
The `AUTH0_AUDIENCE` is the identifier of the API you want to call. You can find this in the API section of the Auth0 dashboard.

Retrieving the token can be achieved by using `getAccessToken`:

```ts
const accessTokenResult = await req.auth0.client.getAccessToken({ request: req, response: res });
console.log(accessTokenResult.accessToken);
```

## Enterprise Connect

> [!NOTE]
> Enterprise Connect is in **Early Access**. To enable it for your tenant, contact Auth0 support.

Enterprise Connect (EC) uses Auth0 as a pure SSO relay: Auth0 federates the login to an enterprise identity provider but writes **no Auth0 session**. Your application owns the session — you establish it yourself in the `onCallback` hook after the login completes.

Enable it with `enterpriseConnect: true` and provide the required `onCallback` hook:

```ts
import { createAuth0 } from '@auth0/auth0-express';

// HMAC helpers — sign and verify the app session cookie so it can't be forged.
const enc = new TextEncoder();
const key = () =>
  crypto.subtle.importKey(
    'raw',
    enc.encode(process.env.AUTH0_SESSION_SECRET!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

app.use(createAuth0({
  domain: '<AUTH0_DOMAIN>',
  clientId: '<AUTH0_CLIENT_ID>',
  clientSecret: '<AUTH0_CLIENT_SECRET>',
  appBaseUrl: '<APP_BASE_URL>',
  sessionSecret: '<SESSION_SECRET>',
  enterpriseConnect: true,
  async onCallback(_req, res, { user, appState }) {
    if (!user) { return res.redirect('/login?error=no-session'); }

    // Optional: validate orgId against your approved-org list before continuing.
    const orgId = (user['org_id'] as string) ?? '';

    // session.user holds the OIDC claims; keep only the fields you need.
    const appSession = { sub: user.sub, email: user.email };

    // Sign the payload so the cookie can't be forged: "<body>.<signature>".
    const body = Buffer.from(JSON.stringify(appSession)).toString('base64url');
    const signature = Buffer.from(
      await crypto.subtle.sign('HMAC', await key(), enc.encode(body))
    ).toString('base64url');

    res.cookie('app_session', `${body}.${signature}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    res.redirect((appState as { returnTo?: string } | undefined)?.returnTo ?? '/dashboard');
  },
}));
```

`onCallback` receives `{ user?, appState? }` and must write your session and end the response (for example with `res.redirect()`) before the promise resolves.

> Do **not** include `offline_access` in `scope` — EC clients receive no refresh token and the access token expires (default 24 h) with no renewal path. Use EC to establish identity only; issue your own tokens for downstream API authorization.

> [!IMPORTANT]
> Because no Auth0 session is written in EC mode, the session-backed `ServerClient` methods (`getUser`, `getSession`, `getAccessToken`, `getAccessTokenForConnection`, …) and the `requiresAuth()` middleware are unavailable — they throw `EnterpriseConnectNotSupportedError`. Guard protected routes with your own session check instead.

### Starting an Enterprise Connect login

Use the exported `startEnterpriseLogin` handler. It runs email-domain Home Realm Discovery (WebFinger) and, if the domain is federated, redirects the browser to Auth0 and returns `true`. For a non-federated domain it does nothing and returns `false`, so you can fall back. It throws on an unexpected error (e.g. misconfiguration), so forward that to your error handler:

```ts
import { startEnterpriseLogin } from '@auth0/auth0-express';

app.post('/login', async (req, res, next) => {
  try {
    const federated = await startEnterpriseLogin(req, res, {
      email: req.body.email,
      returnTo: '/dashboard', // surfaced to onCallback as appState.returnTo
    });

    if (!federated) {
      // Domain is not federated, handle with your own login - replace '/login?mode=password' with your existing login route
      res.redirect('/login?mode=password');
    }
  } catch (err) {
    next(err);
  }
});
```

### Checking Home Realm Discovery yourself

`startEnterpriseLogin` composes two steps: the discovery check and starting the login. If you need to run logic between them, the SDK also re-exports the standalone `isFederatedDomain` function; start the login yourself by redirecting to the mounted `/auth/login` route with the email as `login_hint`:

```ts
import { isFederatedDomain } from '@auth0/auth0-express';

app.post('/login', async (req, res, next) => {
  try {
    const email = req.body.email as string;
    const emailDomain = email?.split('@')[1];
    if (!emailDomain) { throw new Error('Email domain is missing or invalid'); }

    const federated = await isFederatedDomain('<AUTH0_DOMAIN>', emailDomain);
    if (!federated) {
      // Domain is not federated, handle with your own login - replace '/login?mode=password' with your existing login route
      res.redirect('/login?mode=password');
      return;
    }

    res.redirect(`/auth/login?login_hint=${encodeURIComponent(email)}`);
  } catch (err) {
    next(err);
  }
});
```

> [!NOTE]
> `isFederatedDomain` is a routing hint, not a security control. Optionally validate `org_id` from the returned ID token in `onCallback` against your own records regardless of what discovery returned.

Prefer `startEnterpriseLogin` unless you specifically need to intervene between the two steps.

### Logging out

Enterprise Connect logout is always **federated**: it ends the upstream enterprise IdP session as well as the Auth0 session. There are two ways to handle this:

**Option 1 — custom `/logout` route (recommended).** Gives you full control: clear your app session cookie and build the Auth0 logout URL in one place.

```ts
app.get('/logout', async (req, res, next) => {
  try {
    res.clearCookie('app_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    const logoutUrl = await req.auth0.client.logout({
      returnTo: '<APP_BASE_URL>/login',
      federated: true,
    });
    res.redirect(logoutUrl.href);
  } catch (err) {
    next(err);
  }
});
```

**Option 2 — redirect to the mounted `/auth/logout`.** The SDK automatically forces federated logout in EC mode. Clear your app session cookie first, then redirect:

```ts
app.get('/logout', (req, res) => {
  res.clearCookie('app_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  res.redirect('/auth/logout');
});
```

> [!IMPORTANT]
> Register your post-logout URL in the Auth0 application's **Allowed Logout URLs**.

A complete runnable example is available under [`examples/example-express-enterprise-connect`](https://github.com/auth0/auth0-express/tree/main/examples/example-express-enterprise-connect).

## Experiment Center

> [!NOTE]
> Experiment Center is in **Early Access**. To enable it for your tenant, contact Auth0 support.

Experiment Center is Auth0's A/B testing platform for login flows. Pass `experiment_id` and `variation_id` as query parameters on the login URL to force a specific variation for that request, bypassing the server-side deterministic assignment. Both IDs are obtained from your Auth0 Dashboard or the Management API.

```ts
<a href="/auth/login?experiment_id=<EXPERIMENT_ID>&variation_id=<VARIATION_ID>">Log in</a>
```

When the experiment uses segment targeting, also pass `segment_id`:

```ts
<a href="/auth/login?experiment_id=<EXPERIMENT_ID>&variation_id=<VARIATION_ID>&segment_id=<SEGMENT_ID>">Log in</a>
```

> [!IMPORTANT]
> Pass these parameters on the specific login link where you want the override, not in a global middleware that appends them to every `/auth/login` request. Adding them everywhere pins all logins to the same variation, which cancels out the A/B test.
>
> Do not include these parameters when triggering a silent authentication check (`prompt=none`). Experiment Center does not run during silent checks; the parameters will have no effect.

### Testing

When writing integration tests (Cypress, Playwright), read the IDs from environment variables and construct the login URL:

```ts
// Playwright example
await page.goto(
  `/auth/login?experiment_id=${process.env.EXPERIMENT_ID}&variation_id=${process.env.VARIATION_ID}`
);
```

Avoid hardcoding variation IDs in production code — use your Auth0 Dashboard or CI environment variables instead.

### Production usage

In production, obtain variant decisions from a feature-flag service (e.g. LaunchDarkly) that determines the variation per request, then construct the login URL:

```ts
app.get('/login', async (req, res) => {
  const variation = await featureFlagService.getVariation(req);
  const params = new URLSearchParams({
    experiment_id: variation.experimentId,
    variation_id: variation.variationId,
  });
  res.redirect(`/auth/login?${params}`);
});
```

If you have disabled the built-in routes (`mountRoutes: false`) and call `startInteractiveLogin` directly, pass the params via `authorizationParams` instead:

```ts
const url = await req.auth0.client.startInteractiveLogin({
  authorizationParams: {
    experiment_id: '<EXPERIMENT_ID>',
    variation_id: '<VARIATION_ID>',
  },
});
res.redirect(url.href);
```

## Multiple Custom Domains (MCD)

Multiple Custom Domains (MCD) lets you resolve the Auth0 domain per request while using a single `createAuth0` instance. This is useful when one application serves multiple customer domains (for example, `brand-1.my-app.com` and `brand-2.my-app.com`), each mapped to a different Auth0 custom domain.

MCD is enabled by passing a **domain resolver function** to `domain` instead of a static string. The resolver receives the Express request context (`{ request, response }`) and returns the Auth0 custom domain for that request.

> Resolver mode is intended for the custom domains of a **single** Auth0 tenant. It is not a supported way to connect multiple Auth0 tenants to one application.

### Host-based resolver with a default fallback

```ts
import { createAuth0, DomainResolver, StoreOptions } from '@auth0/auth0-express';

const defaultAuth0Domain = 'auth.custom-domain.com';
const domainsByHost: Record<string, string> = {
  'brand-1.my-app.com': 'auth.custom-domain-1.com',
  'brand-2.my-app.com': 'auth.custom-domain-2.com',
};

const domainResolver: DomainResolver<StoreOptions> = (storeOptions) => {
  const host = storeOptions?.request?.headers.host;
  return (host && domainsByHost[host]) || defaultAuth0Domain;
};

app.use(createAuth0({
  domain: domainResolver,
  clientId: '<AUTH0_CLIENT_ID>',
  clientSecret: '<AUTH0_CLIENT_SECRET>',
  sessionSecret: '<SESSION_SECRET>',
  appBaseUrl: '<APP_BASE_URL>',
}));
```

### Header-to-domain map (trusted app routing context)

```ts
import { DomainResolver, StoreOptions } from '@auth0/auth0-express';

const headerValueToAuth0Domain: Record<string, string> = {
  workspace_a: 'workspace-a.custom-domain.com',
  workspace_b: 'workspace-b.custom-domain.com',
};

const domainResolver: DomainResolver<StoreOptions> = (storeOptions) => {
  // App-specific routing key, not Auth0 tenant metadata.
  const routingKey = storeOptions?.request?.headers['x-tenant-id'] as string | undefined;
  return (routingKey && headerValueToAuth0Domain[routingKey]) || 'auth.custom-domain.com';
};
```

### `appBaseUrl` in resolver mode

`appBaseUrl` behaves exactly as documented in [Dynamic Application Base URLs](#dynamic-application-base-urls):

- provide a static string or allow-list, **or**
- omit it to infer the base URL from the request host (enable Express `trust proxy` when behind a proxy).

If you omit `appBaseUrl`, register every inferred origin in Auth0 as an **Allowed Callback URL** and **Allowed Logout URL**.

### Backchannel logout requests

The backchannel logout route (mounted by default) is called **server-to-server by Auth0**, not by the end-user's browser. Such requests do not carry the tenant's `Host` (or any app-specific routing header), so a host- or header-based resolver will not find a match for them. Make sure your resolver returns a sensible default in that case — the fallback in the examples above (`|| defaultAuth0Domain`) handles this. If you have no meaningful default, detect the backchannel logout path and return the appropriate domain explicitly.

### Security requirements

When resolving tenant custom domains via a resolver, you are responsible for ensuring all resolved domains are trusted. Mis-configuring the resolver is a critical security risk that can lead to authentication bypass on the relying party (RP) or Server-Side Request Forgery (SSRF).

- **Single-tenant only:** resolvers are for multiple custom domains of one Auth0 tenant, not for connecting multiple tenants.
- **Secure proxy:** when inferring the host from request headers, deploy behind a trusted edge/reverse proxy (Cloudflare, Nginx, AWS ALB) that sanitizes and overwrites `Host` / `X-Forwarded-Host` before they reach the app. Without that, an attacker can influence domain resolution and produce malicious redirects during login/logout. See the `trust proxy` and allow-list guidance under [Dynamic Application Base URLs](#dynamic-application-base-urls).
## Anonymous Sessions

Anonymous Sessions give unauthenticated visitors a persistent identity before they log in. Use it to carry guest-cart contents, pre-login personalisation data, or Post-Login Action correlation into the authenticated session.

> [!NOTE]
> The Auth0 tenant must have the anonymous sessions feature enabled and the client ID must be configured for anonymous sessions via the Management API.

### Enabling anonymous sessions

Add `anonymousSessions: true` to your `createAuth0` configuration. The SDK creates a JWE-encrypted `__a0_anon` cookie using the same `sessionSecret` as your user session.

```ts
import express from 'express';
import { createAuth0 } from '@auth0/auth0-express';

const app = express();

app.use(createAuth0({
  domain: '<AUTH0_DOMAIN>',
  clientId: '<AUTH0_CLIENT_ID>',
  clientSecret: '<AUTH0_CLIENT_SECRET>',
  appBaseUrl: '<APP_BASE_URL>',
  sessionSecret: '<SESSION_SECRET>',
  anonymousSessions: true,
}));
```

To customise the cookie lifetime (default 30 days, should match your tenant's `sessions.anonymous.lifetime_in_minutes * 60` — `sessionTokenLifetime` is in seconds):

```ts
app.use(createAuth0({
  // ...
  anonymousSessions: {
    sessionTokenLifetime: 7 * 24 * 60 * 60, // 7 days in seconds
    cookie: { sameSite: 'lax', secure: true },
  },
}));
```

> **`cookie.path` warning:** keep the default `/`. Setting a subpath (e.g. `cookie: { path: '/app' }`) scopes the cookie away from the auth routes (`/auth/login`, `/auth/callback`), so the browser will not send it there. This silently disables anonymous-to-authenticated linking at login and the `clearOnLogin` behaviour at callback. Only use a subpath if your auth routes are also mounted under that same path.

### Creating and reading a session

`req.auth0.client.anonymous` is the anonymous sub-client. Call `createSession()` on the visitor's first request to establish their anonymous identity.

```ts
app.post('/api/session/start', async (req, res) => {
  await req.auth0.client.anonymous.createSession({
    metadata: { source: 'landing-page', cart: req.body.cartId },
  });
  const session = await req.auth0.client.anonymous.getSession();
  res.status(201).json({ sub: session?.sub });
});

app.get('/api/session', async (req, res) => {
  const session = await req.auth0.client.anonymous.getSession();
  if (!session) {
    return res.status(404).json({ error: 'no anonymous session' });
  }
  res.json({ sub: session.sub, metadata: session.metadata });
});
```

### Getting an access token

`getAccessToken()` returns a cached token if it is still valid, or re-mints one from the session token otherwise. Pass the API `audience` that the token should be scoped to.

```ts
app.get('/api/data', async (req, res) => {
  const { accessToken } = await req.auth0.client.anonymous.getAccessToken({
    audience: 'https://api.example.com',
  });
  // forward accessToken to your upstream API
  res.json({ token: accessToken });
});
```

### Ending the anonymous session

`logout()` removes the `__a0_anon` cookie. The anonymous session is also cleared automatically when the visitor logs in (controlled by `anonymousSessions.clearOnLogin`, which defaults to `true`).

```ts
app.post('/api/session/end', async (req, res) => {
  await req.auth0.client.anonymous.logout();
  res.sendStatus(204);
});
```

### Error handling

`createSession` throws `AnonymousSessionError` when Auth0 rejects the request. Common codes:
- `feature_not_enabled` — anonymous sessions are not enabled on the tenant
- `unauthorized_client` — the client is not configured for anonymous sessions
- `invalid_request` — metadata exceeds 1 024 bytes or contains non-string values
- `invalid_target` — the requested audience does not allow anonymous access

```ts
import {
  AnonymousSessionError,
  AnonymousSessionExpiredError,
  MissingAnonymousSessionError,
} from '@auth0/auth0-express';

app.post('/api/session/start', async (req, res) => {
  try {
    await req.auth0.client.anonymous.createSession();
    res.sendStatus(201);
  } catch (e) {
    if (e instanceof AnonymousSessionError) {
      // Auth0 rejected the request — check e.code for the reason
      return res.status(403).json({ error: e.code });
    }
    throw e;
  }
});
```

`getAccessToken` throws when the session is missing or has expired on Auth0's side:

```ts
app.get('/api/token', async (req, res) => {
  try {
    const { accessToken } = await req.auth0.client.anonymous.getAccessToken();
    res.json({ accessToken });
  } catch (e) {
    if (e instanceof MissingAnonymousSessionError) {
      // No anonymous session exists — visitor must call createSession first
      return res.status(401).json({ error: 'no_session' });
    }
    if (e instanceof AnonymousSessionExpiredError) {
      // The session token expired on Auth0's side — start a fresh anonymous session
      await req.auth0.client.anonymous.createSession();
      const { accessToken } = await req.auth0.client.anonymous.getAccessToken();
      return res.json({ accessToken });
    }
    throw e;
  }
});
```

### Merging what the visitor did before they logged in

Set `anonymousSessions.clearOnLogin: false` to keep the anonymous session alive through the login flow. You can read it on the first authenticated request after login, then clean it up yourself.

```ts
app.use(createAuth0({
  // ...
  anonymousSessions: { clearOnLogin: false },
}));

app.use(requiresAuth(), async (req, res, next) => {
  const anonSession = await req.auth0.client.anonymous.getSession();
  if (anonSession?.sub) {
    await mergeGuestCart(anonSession.sub, req);
    await req.auth0.client.anonymous.logout();
  }
  next();
});
```

### Custom store

For advanced use cases (e.g. a Redis-backed store), implement the `AnonymousStore` interface and pass it via `anonymousSessions.store`.

```ts
import type { AnonymousStore, StoreOptions } from '@auth0/auth0-express';

class RedisAnonymousStore implements AnonymousStore<StoreOptions> {
  // implement get(), set(), delete()
}

app.use(createAuth0({
  // ...
  anonymousSessions: {
    store: new RedisAnonymousStore(),
    identifier: '__a0_anon', // optional, defaults to '__a0_anon'
  },
}));
```

## Personal Agent Protocol (Poppy)

With the `poppy` option, your Express website can take part in [Poppy (Personal Agent Protocol)](https://personalagentprotocol.org/docs/spec#web-browsing) web browsing. The support is in beta, and it is not tied to one protocol version: the package serves your `poppy.json` as written. A Personal Agent is software that acts for a user. It drives a browser of its own, and that browser joins the agent's Session before it visits your website. A runnable example is in [`examples/example-express-web-poppy`](../../examples/example-express-web-poppy).

### What changes when you turn on Poppy

Turn it on with `poppy: true`. When an agent's browser joins your website, this happens:

1. The agent's browser opens the Auth0 page at `web.browser_session_endpoint` of your config file.
2. Auth0 sends it to your Application Login URI, `https://<site>/auth/login`, as a [third-party initiated login](https://openid.net/specs/openid-connect-core-1_0.html#ThirdPartyInitiatedLogin). The query can carry `iss` and `target_link_uri`.
3. The login route reads them when they are there, and starts a normal login. It uses `target_link_uri` as the landing page only when `iss` is your issuer and the target is a page of your site. A request with an `iss` that is not your issuer is refused with `400`, and no login starts.
4. The callback turns the result into a guest or a signed-in agent. A guest has not signed in, and is kept in its own encrypted `__Host-a0_poppy` cookie. A signed-in agent is a normal session whose `act` claim names the agent.

The login route works whether or not Auth0 sends `iss` and `target_link_uri`. Without an `iss`, it is a normal login. Without a usable `target_link_uri`, the browser lands on the home page of your site. When the browser already has a login that a join may not replace, Auth0 shows its own `session_conflict` page, and nothing reaches your app.

Without the option, nothing changes. This is what `poppy` changes:

| | Without `poppy` | With `poppy` |
| --- | --- | --- |
| `/.well-known/poppy.json` and `/.well-known/oauth-protected-resource` | Not served by the router | Served on `GET` and `HEAD`, before any cookie or session handling |
| `/auth/login` | Sends `iss` and `target_link_uri` on to `/authorize`, like any other parameter | Refuses an `iss` that is empty, repeated or not your issuer with `400`, before it writes a cookie (see [Poppy errors](#poppy-errors)). Sends neither `iss` nor `target_link_uri` on. Lands on a valid `returnTo`, or else on the `target_link_uri` of your site when `iss` is your issuer |
| `/auth/callback` | Any failure answers `500` | Turns an agent's join into a guest or a signed-in agent. A refused login and an ended session get `403` (see [Poppy errors](#poppy-errors)) |
| `/auth/logout` | Ends the session | Also drops the guest. When the browser held a guest, or holds no session at all, it redirects to `/v2/logout` of your tenant, because the OIDC logout endpoint is for a user, and a guest has none (see [Sign out a guest](#sign-out-a-guest)) |
| `getUser()` and `requiresAuth()` | See the signed-in user | The same for a user. A guest is not a user, so `requiresAuth()` answers a guest with `403` (or calls `onGuest`) and never redirects it. The SDK never writes a guest and a person's session together (see [Guard pages from guests](#guard-pages-from-guests)) |
| `req.auth0.client.poppy` | Throws `InvalidConfigurationError` | Is there |

**Not supported with `poppy`.** Poppy has one issuer, so a domain resolver (Multiple Custom Domains) and `enterpriseConnect` are startup errors. `createAuth0()` throws `InvalidConfigurationError` with these texts:

- `Invalid poppy configuration: domain must be a string. A domain resolver is not supported because Poppy has one issuer.`
- `Invalid poppy configuration: poppy cannot be combined with enterpriseConnect.`

A custom `sessionStore`, `legacyCompatibility`, `anonymousSessions` and `pushedAuthorizationRequests` work with `poppy`.

**What a join does to an anonymous session.** Every join of an agent clears the regular anonymous session of the browser, a guest's join too, as a normal login does, unless `anonymousSessions.clearOnLogin` is `false`. A guest is not a user, but the browser is the agent's now, and a leftover anonymous session would answer for it and would be linked to the next person's account. So a guest that has ended does not bring the anonymous visitor back. If you merge what a visitor did before they logged in, see [Merging what the visitor did before they logged in](#merging-what-the-visitor-did-before-they-logged-in): it applies to a signed-in agent's join. With `clearOnLogin: false` a guest join keeps the anonymous session too, and the merge sample does not run for a guest, because `requiresAuth()` stops it, so clear that session yourself.

### Set up Auth0 and the config file

**Auth0.** Poppy is in beta on Auth0, so your tenant needs it enabled. The application of your site is a Regular Web Application and a first-party application, which is the default for the applications that you create in the Dashboard. Turn `poppy` on in your app before you run the setup below. Without it, the login route sends `iss` and `target_link_uri` on to `/authorize`, and a join makes an ordinary session. A session that such a join made stays an ordinary session when you turn `poppy` on later, and it passes as a user, so turn `poppy` on first.

Set up the application with the Auth0 CLI:

```sh
auth0 poppy setup --company-domain <your-domain>
auth0 poppy config
```

`auth0 poppy setup` configures your application for the browser join of an agent, asks you for its Application Login URI (give it `https://<site>/auth/login`, and it must be HTTPS), and writes `poppy.json`. `auth0 poppy config` writes the file again from the tenant. Keep `https://<site>/auth/callback` in the **Allowed Callback URLs** of the application. When the application is not set up for the join, Auth0 refuses it with an error page.

**The file.** Your website describes itself to agents in `poppy.json`, the file that `auth0 poppy config` writes. Pass it as it is: this package serves it as written, and it needs no change or cast. You can also write it by hand. `PoppyConfig`, the type of the parsed file, names the two members that this package reads. Every other member is kept and served as it is, so a member that a later version of the protocol or of the CLI adds needs no change here.

| Member | What it is | Checked by this package |
| --- | --- | --- |
| `protocol_version` | The Poppy version that the file is written for, such as `"1.0"` | No |
| `organization.name` | The name of your organization | No |
| `organization.domain` | The host that serves `poppy.json`: lowercase, with its port when the port is not 443 (`localhost:3000`, `shop.example.com:8443`), and with no scheme or path ([spec 3.1](https://personalagentprotocol.org/docs/spec#fields)) | Yes |
| `auth.issuer` | Your Auth0 issuer. It must be exactly `https://<AUTH0_DOMAIN>/`, with the trailing slash | Yes |
| `auth.scopes`, `auth.scope_hints` | The scopes of your website, and for each scope whether it `changes` data (`none`, `reversible` or `irreversible`) and uses `personal_data` | Only by `verifyConfig()`, which reads the names of the scopes (see [Serve the discovery files](#serve-the-discovery-files)) |
| `apis` | Your APIs: each has a `type`, a `url` and a `description` | No |
| `web.browser_session_endpoint` | The https URL where an agent's browser joins a Session | No |
| `web.unscoped` | `true` when your website does not apply the other scopes of the file, so that a signed-in browser with the scope `poppy:browser-sign-in` has the full access of the account there. Agents read it before they ask for the scope. **This package applies no scopes, so see [Scopes](#scopes)** | No |

The examples in this section use a shop at `shop.example.com`, whose Auth0 domain is `login.shop.example.com` and whose application has the client ID `web_app_client`. This is the file as the CLI writes it:

```json
{
  "protocol_version": "1.0",
  "organization": {
    "name": "Shop",
    "domain": "shop.example.com"
  },
  "auth": {
    "issuer": "https://login.shop.example.com/",
    "scopes": {
      "orders:read": "orders:read",
      "poppy:browser-sign-in": "poppy:browser-sign-in"
    },
    "scope_hints": {
      "orders:read": {
        "changes": "none",
        "personal_data": true
      },
      "poppy:browser-sign-in": {
        "changes": "none",
        "personal_data": false
      }
    }
  },
  "apis": [
    {
      "type": "openapi",
      "url": "https://shop.example.com/openapi.json",
      "description": "https://shop.example.com"
    }
  ],
  "web": {
    "browser_session_endpoint": "https://login.shop.example.com/poppy/web_app_client/browser-session",
    "unscoped": false
  }
}
```

**Where and when it is read.** `createAuth0()` takes the config from `poppy.config` (the parsed file) when you pass it. Otherwise it reads the file at `poppy.configPath`, and without that it reads `poppy.json` in `process.cwd()`. It reads the file once, when `createAuth0()` runs, so a change to the file needs a restart. A relative path is resolved against `process.cwd()` at that moment, so an app that starts from another folder should set `configPath`.

```ts
import { createAuth0 } from '@auth0/auth0-express';

// Reads poppy.json from the working directory.
app.use(createAuth0({ /* ... */ poppy: true }));
```

```ts
import { createAuth0 } from '@auth0/auth0-express';

// Reads the file next to this module, whatever the working directory is.
app.use(createAuth0({
  /* ... */
  poppy: { configPath: new URL('./poppy.json', import.meta.url) },
}));
```

**Startup errors.** `createAuth0()` throws `InvalidConfigurationError` at startup when the file cannot be read, is not valid JSON, or holds a config that is not valid or does not fit your `domain`. Every message for these causes starts with `Invalid poppy configuration:`. When the file is the problem, the message names its path and never shows its content. For example, an `auth.issuer` that is not the issuer of your Auth0 domain stops the app with `Invalid poppy configuration: config.auth.issuer must match Auth0's issuer for the ServerClient domain exactly, trailing slash included. Expected: https://login.shop.example.com/`. The expected issuer comes from your `domain` option, so the message tells you which side to change.

**Options.** `poppy: true` is the same as `poppy: {}`. These options are all optional:

| Option | Default | What it does |
| --- | --- | --- |
| `config` | none | The parsed `poppy.json` that `auth0 poppy config` writes, as it is. When set, no file is read and `configPath` is ignored |
| `configPath` | `'poppy.json'` | Where to read the file: a path, or a `file:` URL object. A relative path is resolved against `process.cwd()` |
| `guestStore` | the built-in `StatelessPoppyGuestStore`, which keeps the guest in an encrypted cookie | Your own store for guests, such as one backed by Redis. When set, `cookie` is ignored. It must tell one browser from another (see [Custom guest store](#custom-guest-store)) |
| `cookie` | `{ sameSite: 'lax', secure: true, path: '/' }` | Attributes of the guest cookie. It does not follow `sessionConfiguration.cookie`, and it is ignored with `guestStore`. With these defaults the cookie is named `__Host-a0_poppy`: the `__Host-` prefix makes a browser refuse it from a sibling host, from a `Domain` attribute and from a plain HTTP page, so another site on your domain cannot plant a guest in a visitor's browser. With `secure: false` or another `path` (local development), a browser would refuse the prefix, so the cookie is named `__a0_poppy` and has no such protection. The name cannot be changed. `createAuth0()` throws `InvalidConfigurationError` at startup when `sessionConfiguration.cookie.name` or `anonymousSessions.identifier` is the same as the name, the start of it (such as `__a0_pop`), or starts with the name and a dot, because the cookie-backed stores find their cookies by the start of the name. The message calls the options `stateIdentifier` and `anonymousSessionIdentifier` |
| `agentSessionMaxAge` | `7200` | The longest one login of an agent on your website lasts, in seconds (a new login starts a new deadline, except a guest that gets a new token, which keeps the first one): a whole number above 30, because a session ends 30 seconds before its deadline. It can end sooner because of the `exp` or the `session_expiry` of the ID token. This package does not see the end of the agent's Poppy Session |
| `protectedResource` | inferred from the config | Your own members for the `oauth-protected-resource` document ([RFC 9728, section 2](https://www.rfc-editor.org/rfc/rfc9728#section-2)). A member you give is served as it is, and a member you leave out is inferred |

A custom `guestStore` gets the Express request and response in every call, as `{ request, response }`, so it can tell one browser from another. See [Custom guest store](#custom-guest-store).

> **`cookie.path` warning:** keep the default `/`. A sub-path (for example `cookie: { path: '/shop' }`) scopes the guest cookie away from the auth routes (`/auth/login`, `/auth/callback`, `/auth/logout`). The browser will not send it there, so the SDK cannot see the guest on those routes.

### Scopes

`requiresAuth()` and the claim checks do not look at the scopes of an agent's join. A signed-in agent passes them as the user, with the full access of the account, whatever scopes the user approved. On a signed-in join, Auth0 does narrow the **access token** that your web app gets, to the scopes of the agent, when your login route asks for the audience of the token of the join (see [The audience of your login route](#the-audience-of-your-login-route)). It does not narrow the ID token, `/userinfo` or the claims of the session, and this package applies no scopes to your routes. The specification says a website must either apply the scopes of the file or say that it does not, with `web.unscoped: true`, because agents and users read that member before they approve a scope. So decide once:

- **Your routes use only `requiresAuth()`:** set `web.unscoped` to `true` in the `poppy.json` that you deploy. This package serves the file as written, so the change is served as it is. The sample file above is the file as the CLI writes it, with `unscoped` at `false`, and it says that scopes apply, which would not be true for such a site.
- **You apply scopes:** check them in your routes, as this middleware does. A person who logged in on their own has no agent, and the check lets them through.

```ts
import type { NextFunction, Request, Response } from 'express';

// Put `requiresAuth()` in front of it: a visitor with no session is a `human` context too, and would pass this check.
function requiresScope(scope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = await req.auth0.client.poppy.getContext();

      // `scopes` are the scopes of the token of the join, for a signed-in agent. A guest has none.
      if (context.kind === 'agent' && !context.scopes.includes(scope)) {
        res.status(403).json({ error: 'insufficient_scope', scope });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

app.post('/orders/cancel', requiresAuth(), requiresScope('orders:cancel'), (req, res) => {
  res.sendStatus(204);
});
```

### The audience of your login route

On a signed-in join, Auth0 ties the session of the browser to the **audience** and the scopes of the access token that the agent used to join. Every login that your login route then starts over that session has to ask for that audience:

- **Set `audience` to the identifier of the API of the agent's token, character for character.** A trailing slash makes it another value. Otherwise Auth0 sends the browser back to your callback with `error=access_denied`, nothing is stored, and the callback answers `500`. The original error is on `error.cause`. The check runs on every login over that session, a login for `openid` only too.
- **No `audience` means the default audience of your tenant.** That works only when the default audience is the API of the agent's token. A tenant with no default audience always fails.

```ts
app.use(createAuth0({
  // ...
  audience: 'https://shop.example.com', // the identifier of the API that the agent's token is for
  poppy: true,
}));
```

### Serve the discovery files

With `poppy` set, and `mountRoutes` not `false`, the router serves the two files that agents read, at the paths that the specification fixes ([section 3](https://personalagentprotocol.org/docs/spec#discovery), [section 3.2](https://personalagentprotocol.org/docs/spec#oauth-server) and [RFC 9728, section 3](https://www.rfc-editor.org/rfc/rfc9728#section-3)):

- `/.well-known/poppy.json`, which is your config file as written.
- `/.well-known/oauth-protected-resource`, which names your website as the resource and your Auth0 issuer as its authorization server.

Both answer `GET` and `HEAD` with `200`, `content-type: application/json`, `cache-control: public, max-age=300` and `x-content-type-options: nosniff`. For these two methods the router answers before it reads or sets a cookie, so a `GET` or `HEAD` request for a file never touches a session. Other methods such as `POST`, a different case, a trailing slash or an encoded path fall through to the rest of your app, which answers `404` by default.

Mount `createAuth0()` at the root of the site at `https://<organization.domain>`, and before any middleware that sets cookies, such as a session middleware. Middleware that runs first also runs for these two files. The answer carries `cache-control: public, max-age=300`, so a shared cache could keep a cookie that rides on it. The router removes a `Set-Cookie` that such middleware has already set, but not one that is added when the response ends (for example `express-session`).

With the sample file above, the two files look like this as the app sends them. The `Date` and other standard headers are left out:

```bash
$ curl -i https://shop.example.com/.well-known/poppy.json
HTTP/1.1 200 OK
content-type: application/json
cache-control: public, max-age=300
x-content-type-options: nosniff
Content-Length: 596

{"protocol_version":"1.0","organization":{"name":"Shop","domain":"shop.example.com"},"auth":{"issuer":"https://login.shop.example.com/","scopes":{"orders:read":"orders:read","poppy:browser-sign-in":"poppy:browser-sign-in"},"scope_hints":{"orders:read":{"changes":"none","personal_data":true},"poppy:browser-sign-in":{"changes":"none","personal_data":false}}},"apis":[{"type":"openapi","url":"https://shop.example.com/openapi.json","description":"https://shop.example.com"}],"web":{"browser_session_endpoint":"https://login.shop.example.com/poppy/web_app_client/browser-session","unscoped":false}}
```

```bash
$ curl -i https://shop.example.com/.well-known/oauth-protected-resource
HTTP/1.1 200 OK
content-type: application/json
cache-control: public, max-age=300
x-content-type-options: nosniff
Content-Length: 99

{"resource":"https://shop.example.com","authorization_servers":["https://login.shop.example.com/"]}
```

A `HEAD` request gets the same status and headers, with no `Content-Length` and no body.

**Under a sub-path.** If you mount the router under a sub-path (`app.use('/shop', createAuth0({ ... }))`), or a proxy strips a prefix, the files are served under that prefix, for example at `/shop/.well-known/poppy.json`. Agents ask only the root of `organization.domain`, so they do not find them there. The router logs one warning, on the first request through a sub-path that is not for one of the two files. It sees the mount path of Express only, so it cannot see a proxy that strips a prefix.

**With `mountRoutes: false`.** The router then serves neither file. Serve them from a route of your own, after the router:

```ts
import express from 'express';
import { createAuth0 } from '@auth0/auth0-express';

const app = express();

app.use(createAuth0({
  /* ... */
  poppy: true,
  mountRoutes: false,
}));

// Put this route before any middleware that sets cookies.
app.get(['/.well-known/poppy.json', '/.well-known/oauth-protected-resource'], (req, res, next) => {
  // Gives the status, the headers and the body for these two paths, and undefined for any other path.
  const document = req.auth0.client.poppy.getDiscoveryDocument(req.path);

  if (!document) {
    next();
    return;
  }

  // Not res.send() or res.json(): both add `; charset=utf-8` to the content-type and an ETag,
  // because res.json() calls res.send().
  res.status(document.status);
  // The files are public and a cache may keep them, so they carry no cookie that earlier middleware set.
  res.removeHeader('Set-Cookie');
  for (const [name, value] of Object.entries(document.headers)) {
    res.setHeader(name, value);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(document.body);
});
```

**Mounting the routes yourself.** With `mountRoutes: false`, the login and callback routes are yours too. Your login route calls `parseLoginInitiation()` first, before anything writes a cookie. It gives back `returnTo`, which is the `target_link_uri` when `iss` is your issuer once and the target is a page of your site, and otherwise nothing. A request with no `iss` is a normal login. A request with an `iss` that is empty, repeated or not your issuer is refused: the method throws an `IssuerValidationError`, with a fixed text, and nothing of the request is logged. Answer `400` and start no login. It also gives back `authorizationParams`, which are the other query parameters, and never `iss` or `target_link_uri`. They come from a browser, so pass on only the ones you choose:

```ts
const APP_BASE_URL = 'https://shop.example.com';

app.get('/custom/login', async (req, res, next) => {
  try {
    // Build the URL from the query alone. `req.originalUrl` is the whole URL when a client sends a request target in
    // absolute form (`GET http://host/path`), and `new URL()` throws for a host that the URL parser refuses.
    const loginUrl = new URL(APP_BASE_URL);
    const queryStart = req.originalUrl.indexOf('?');
    loginUrl.search = queryStart === -1 ? '' : req.originalUrl.slice(queryStart);

    let returnTo: string | undefined;

    try {
      ({ returnTo } = req.auth0.client.poppy.parseLoginInitiation(loginUrl, { appOrigin: APP_BASE_URL }));
    } catch (error) {
      // An `iss` that is not your issuer: the request says that it comes from another issuer, so start no login.
      // Compare the `code`. `instanceof` can be false when your app has its own copy of server-js.
      if ((error as { code?: string }).code === 'issuer_validation_error') {
        res.status(400).send('Invalid iss query parameter: it is not the Auth0 issuer this app uses.');
        return;
      }

      throw error;
    }

    const authorizationUrl = await req.auth0.client.startInteractiveLogin({
      appState: { returnTo: returnTo ?? `${APP_BASE_URL}/` },
      authorizationParams: { redirect_uri: `${APP_BASE_URL}/custom/callback` },
    });

    res.redirect(authorizationUrl.href);
  } catch (error) {
    next(error);
  }
});
```

Your callback route finishes the login with `req.auth0.client.completeInteractiveLogin(url)`, where `url` is the full URL of the callback request. This call turns the join into a guest or a signed-in agent. It throws `PoppyError` or `SessionExpiredError` for the callback failures in [Poppy errors](#poppy-errors), and you choose the status.

**Checking the config against Auth0.** `createAuth0()` does not call `verifyConfig()`. That method compares your config with the metadata of your Auth0 tenant the way an agent does, and returns the problems it finds. An agent that finds a mismatch in the resource or the scopes does not use your discovery files, and it does not say so. The client is reachable through a request, so this middleware, which goes after the router, checks once per process, on the first request, and logs what it finds. It does not make the request wait:

```ts
import { createAuth0 } from '@auth0/auth0-express';

app.use(createAuth0({ /* ... */ poppy: true }));

let checked = false;

app.use((req, _res, next) => {
  if (!checked) {
    checked = true;
    req.auth0.client.poppy
      .verifyConfig()
      .then((issues) => {
        for (const issue of issues) {
          console.warn(`Poppy config: ${issue.code}: ${issue.message}`);
        }
      })
      .catch((error: unknown) => console.error('The Poppy config check failed.', error));
  }

  next();
});
```

The log line names the problem. `verifyConfig()` reports `protected_resource_missing` when the metadata of Auth0 does not list the resource of your website, and `scopes_not_supported` when neither the metadata nor the `scopes_supported` of your `protectedResource` option lists the scopes of your config or `poppy:browser-sign-in`. On a tenant with the Poppy beta, Auth0 lists the resource and the scopes, so an issue means that your config and Auth0 disagree, and agents will not use your discovery files until you fix the cause.

### Read who is driving the browser

On Express 4, an async handler must catch errors and call `next(error)`; the snippets below show that where it matters.

Ask `req.auth0.client.poppy.getVisitor()` who is behind a request. It looks in a fixed order, and the first match decides:

1. A **guest**: an agent's browser that joined without signing in.
2. A **user**: a user session. When an agent joined it, `visitor.poppy` is set, and this user is a signed-in agent.
3. An **anonymous** session, when you turn on `anonymousSessions`.
4. **None**.

The guest comes first because an agent drives the browser then. A guest and a user session never share a browser: a guest join ends the session of a person, and while a guest is there, a person's login is refused (see [Guard pages from guests](#guard-pages-from-guests)). Handle every kind in one `switch`, and end it with a `never` check, so that your build stops when a later version adds a kind:

```ts
import type { PoppyVisitor } from '@auth0/auth0-express';

function describeVisitor(visitor: PoppyVisitor): string {
  switch (visitor.kind) {
    case 'none':
      return 'Nobody has joined or signed in from this browser.';
    case 'anonymous':
      // Only with `anonymousSessions`. The session is `visitor.anonymous`.
      return 'This browser has an anonymous session.';
    case 'user':
      // A signed-in agent has `visitor.poppy`. A person who logged in on their own has not.
      return visitor.poppy ? 'A signed-in agent is browsing.' : 'A person is signed in.';
    case 'guest':
      // An agent's browser whose user has not signed in. A guest is not a user.
      return 'An agent is browsing for a user who has not signed in.';
    default: {
      // This stops compiling when a later version adds a kind that the switch does not handle.
      const unhandled: never = visitor;
      return unhandled;
    }
  }
}

app.get('/', async (req, res, next) => {
  try {
    res.send(describeVisitor(await req.auth0.client.poppy.getVisitor()));
  } catch (error) {
    next(error);
  }
});
```

**The context.** `visitor.poppy` is a `PoppyAgentContext`. It mirrors the ID token of the join: `sub` (the guest, or the user the agent acts for), `sub_profile` when the token has one, the whole `act` claim, and `scopes` (empty for a guest, and the scope of the access token of the join for a signed-in agent). `state` is `'guest'` or `'signed_in'`. `act.sub` is the agent: the URL of its metadata, or the Auth0 id of the agent (`agt_...`) when its client is linked to an agent in the Auth0 dashboard, and then it is not a URL. The Session is named by `act.poppy_sid` and `act.poppy_user_id`, and `act.poppy_agent_id` names the agent inside its Personal Agent. The names of the claims are kept as the token writes them (`sub_profile`, `poppy_sid`).

**Keys.** Keep data that belongs to an agent, such as a cart, under `visitor.poppy.key`. It is an opaque key for this agent, Session and User: a hash of `act.sub`, `act.poppy_sid` and `act.poppy_user_id`. It is not the user, because a guest has none. It is not `act.poppy_sid` alone either, because each agent chooses its own Session IDs, so two agents can pick the same one, and one agent can use the same one for two Users (each of them is a Session of its own, with its own key). An API that gets the same agent through its `Poppy-Session` header sees the URL of the agent in both cases, so for a linked agent the key of the API can differ from the key here.

**The key can change when a guest signs in.** The key stays the same only while those three claims are equal in the guest's join and in the join that signs in. This package does not compare the two joins, because Auth0 issues the Poppy Session, and its members can differ from those of the guest's join. When one of them differs, the key is another one, and what you kept under the key of the guest is not found under the new key. So treat the key as the key of one join. Keep under it data that you can afford to lose when the agent signs in, such as the cart of a guest, which ends at its deadline in any case. The built-in callback deletes the guest as it signs in the agent, so the old key cannot be read afterwards. Only a callback route of your own (`mountRoutes: false`) can read the key with `getVisitor()` before it calls `completeInteractiveLogin()`, and move the data to the new key.

```ts
import type { PoppyVisitor } from '@auth0/auth0-express';

// The key of the cart of a visitor, or undefined when the visitor has no cart.
function cartKey(visitor: PoppyVisitor): string | undefined {
  if (visitor.kind === 'guest') {
    return visitor.poppy.key;
  }

  if (visitor.kind === 'user') {
    // A signed-in agent has the key of its own join, which is the key of its guest only when the `act` is the same. A person
    // has no `poppy`, so the account is the key.
    return visitor.poppy?.key ?? visitor.user.sub;
  }

  return undefined;
}
```

**Tokens.** Neither a guest nor a signed-in agent has a refresh token. Each has the access token of its join, and the SDK does not renew it by itself. A new token comes only from a new login.

A guest reads its token with `req.auth0.client.poppy.getGuestAccessToken()`. It gives `undefined` once the token has expired, even while the guest goes on. The same guest (the same `sub` and the same `act.poppy_sid`) gets a new token from a silent login (`/auth/login?prompt=none`) at any time, and from any other login once its token has expired. Any other login of the same guest is refused while its token is valid, so do not send the browser to the login route for that.

A new token keeps the creation time and the deadline of the first join, so it does not move the end of the guest (the deadline can only get earlier). That holds while the stored guest is still there and more than 30 seconds from its end: a login in the last 30 seconds, after the deadline, or after the guest cookie was cleared is a new guest with a new deadline. Auth0's own session ends two hours after the join, so a silent login after that fails with `login_required`, the callback answers `500`, and the agent has to join again.

The login route passes `prompt` on to Auth0, so anyone can link to `/auth/login?prompt=none`. For a guest it only gives a new token. For a visitor with no guest it is the normal login without a prompt: it signs in a visitor who has an Auth0 session, and gives `500` (`login_required`) to one who has none. When Auth0 signs a person in while a guest is in the browser, the callback refuses it with `403`. Start your own silent login when `getGuestAccessToken()` gives `undefined`, and not on every request of a guest, or the page would loop through Auth0.

A signed-in agent calls `getAccessToken()`, as a person does. When its token has expired, which can be before the session ends, the call rejects with `TokenByRefreshTokenError`. The error comes from the SDK, and this package does not export its class. It is a normal token error, so let it reach your error handler with `next(error)`:

```ts
import { requiresAuth } from '@auth0/auth0-express';

// Where an agent must not act as the person, also use requiresUser() (see Guard pages from guests).
app.get('/api/orders', requiresAuth(), async (req, res, next) => {
  try {
    const { accessToken } = await req.auth0.client.getAccessToken();
    const response = await fetch('https://shop.example.com/api/orders', {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    res.status(response.status).json(await response.json());
  } catch (error) {
    next(error);
  }
});
```

**After the deadline.** A signed-in agent's session counts as ended 30 seconds before its deadline. From then on `getVisitor()` and `getUser()` no longer see the agent, and `requiresAuth()` redirects or answers `401`. So you do not normally see `SessionExpiredError` in a guarded route. It reaches you in a route that reads the token without a guard.

### Guard pages from guests

`requiresAuth()` does not let a guest pass, and it does not send a guest to the login route. A guest cannot sign in on your website: the person the agent acts for signs in through the agent, and the agent then joins again. Auth0 can keep the anonymous session of the join for single sign-on, so the login route can bring back the same guest, and the SDK refuses a person's login, and the same guest coming back from a login that is not silent while its access token is valid (`poppy_sign_in_required`). A login cannot sign a guest in as a user, so a redirect to the login route is no use. A guest gets `403` with a short text, or with a JSON body for an API client. A visitor with no login at all is redirected to `/auth/login` or gets `401`, as before. With `poppy` set, `requiresAuth()` and the claim checks make one read of the visitor, which looks at the guest, the user and the anonymous session. A store that fails is never read as empty, so a failing custom anonymous store (`anonymousSessions.store`) gives a `500` to a visitor with no login, where without `poppy` it gives the `401` or the redirect, because only the session store is read then.

`requiresAuth()` and the claim checks read the guest store on every request, before the session, so a guest store that fails answers `500` there, signed-in users included.

To answer a guest in your own way, pass `onGuest`. It receives `req`, `res` and `next`. Answer the request, or call `next()` to let the route run. It is called only for a guest, and only with the `poppy` option.

```ts
import { requiresAuth } from '@auth0/auth0-express';

app.get(
  '/orders',
  requiresAuth({
    onGuest: (_req, res) => {
      res.status(403).send('Ask your agent to sign in for the user, and then browse again.');
    },
  }),
  (req, res) => {
    res.send('Your orders.');
  }
);
```

**The SDK never writes a guest and a person's session together.** The specification says that a join without an access token should not end or change a login that the browser has ([section 6](https://personalagentprotocol.org/docs/spec#web-browsing)). This package ends it on purpose: a guest join deletes the session of a person (it first revokes the refresh token of that session, best effort), so an agent never acts with an account that it was not approved for. While a guest is in the browser, a person's login is refused with a `PoppyError` (`poppy_sign_in_required`), and a signed-in agent's join, a new guest join, or the same guest logging in again for a new token (see Tokens above) replaces the guest. So `getUser()` and `requiresAuth()` do not see a person next to a guest, except after two logins that race in one browser. The specification also says that an agent joins only a browser it controls, never the user's own browser, but your site cannot verify that. Where an agent must not act as the person, for example for an irreversible action, check `getVisitor()`. This middleware lets only a user through. With `personOnly`, it also refuses a signed-in agent, for the pages where the person alone may act:

```ts
import type { NextFunction, Request, Response } from 'express';
import { requiresAuth } from '@auth0/auth0-express';

function requiresUser({ personOnly = false } = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const visitor = await req.auth0.client.poppy.getVisitor();

      // A guest never passes. A signed-in agent has `visitor.poppy`.
      if (visitor.kind !== 'user' || (personOnly && visitor.poppy)) {
        res.status(403).send('This page is not open to agents.');
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

// A user, or an agent whose user has signed in.
app.get('/orders', requiresAuth(), requiresUser(), (req, res) => {
  res.send('Your orders.');
});

// The person alone.
app.post('/account/delete', requiresAuth(), requiresUser({ personOnly: true }), (req, res) => {
  res.sendStatus(204);
});
```

**A guard that you write yourself must not redirect a guest either.** A middleware such as `hasUserMiddleware` in [Using custom middleware](#using-custom-middleware) redirects every visitor without a user to `/auth/login`, a guest too. A login cannot sign a guest in as a user, so the redirect is no use to a guest. Put `requiresAuth()` in front of it, or answer a guest in your own code: `req.auth0.client.poppy.getContext()` tells you whether the visitor is a guest (`context.kind === 'agent' && context.state === 'guest'`). The claim checks (`claimEquals()`, `claimIncludes()` and `claimCheck()`) answer a guest with `401` and never redirect, so a guest gets `401` there and `403` from `requiresAuth()`. Both look for the guest first, so a guest cookie next to a session cookie is a guest to them as well.

### Sign out a guest

`/auth/logout` clears the guest cookie and the session, as it does for any logout, and then redirects the browser to Auth0. Where it redirects depends on the visitor:

- When the browser held a guest, or holds no user session at all (the guest may have ended, and Auth0 may still hold the anonymous session of the join), the redirect goes to the `/v2/logout` endpoint of your tenant. The OIDC logout endpoint that the tenant advertises (`/oidc/logout`) is for a user, and a guest has none.
- For a person or a signed-in agent, the redirect goes to the end session endpoint of the tenant, as before.

`/auth/logout` is a `GET` route, and `/v2/logout` ends the Auth0 session with no confirmation page, so a link on another site can send a browser that has no session on your site there and end its single sign-on session (with `?federated=true`, the session of the identity provider too). For a person or a signed-in agent the OIDC logout endpoint asks the visitor to confirm. If that matters to you, write your own logout route that answers a `POST`.

If you write your own logout route, redirect to the URL that `req.auth0.client.logout()` returns, and do not build the logout URL yourself. As for any logout, `returnTo` has to be in the Allowed Logout URLs of the application.

### Poppy errors

With `poppy` set, some failures of the callback route get `403` in place of `500`. Each error has a fixed text and a fixed `code`, goes to Express with `next(error)`, and keeps the original error on `error.cause`. A refused or failed callback writes no session and no guest, and leaves what the browser had. The login route refuses a request whose `iss` is not your issuer with `400` (below). A `target_link_uri` that it cannot use is ignored, and the login goes on as a normal login.

| Status | `error.code` | Route | When | `error.message` |
| --- | --- | --- | --- | --- |
| `403` | `poppy_sign_in_required` | `/auth/callback` | A guest is in the browser, and the login is none of these: a signed-in agent's, a new guest's, or the same guest renewing its token (a silent login, or any login once the token has expired) | `An agent's guest is in this browser, so only a signed-in agent, a new guest join, or the same guest renewing its access token can replace it. Log out to sign in as a person.` |
| `403` | `invalid_poppy_guest` | `/auth/callback` | The ID token looks like a guest's but is not valid | `The ID token looks like the login of a Poppy guest but is not a valid one, so it is neither a guest nor a user.` |
| `403` | `invalid_poppy_agent` | `/auth/callback` | The ID token holds a Poppy Session that is not well formed, or an agent's token has no valid `sub` or `exp` | `The ID token holds a Poppy Session that is not well formed, so it is neither a signed-in agent nor a user.` |
| `403` | `session_expired` | `/auth/callback` | The session has already ended | `The session of this login has already ended.` |
| `400` | `issuer_validation_error` | `/auth/login` | The query has an `iss` that is empty, repeated or not your issuer, character for character. Another case and a missing trailing slash are other values. No login starts and no cookie is set | `Invalid iss query parameter: it is not the Auth0 issuer this app uses.` |
| `500` | none | login, callback and logout | Everything else, as today | `Authentication request could not be completed.` |

The first three are a `PoppyError` of server-js, and the code is the `code` of that error. Compare `error.code` with `PoppyErrorCode`, which this package exports, and do not use `instanceof` for it: the check also works when your app has its own copy of server-js. `poppy_sign_in_required` means a person has to log out first, and `invalid_poppy_guest` and `invalid_poppy_agent` are a problem with the setup of Auth0 or of the agent, so log them. The text of each is fixed for its code, holds no value of a token, and is safe to show. `error.cause.reason` is for logs only. A login whose ID token has a `session_expiry` that has already passed also gets the `session_expired` error, a person's login too, and it is `403` and not `401` because a `401` needs a `WWW-Authenticate` challenge, and a login has none.

The error handler that you have decides what the browser sees. The default handler of Express writes the body: in production it is the status text, such as `Forbidden`, and otherwise it is the stack of the error, which holds the fixed text and nothing from the request. It never includes `cause`. So the default handler gives a person who is refused with `poppy_sign_in_required` no link to log out: in production the page says only `Forbidden`, and outside production it shows the stack with the fixed text. Express also logs the stack of every error that reaches its default handler when `NODE_ENV` is not `test`, a `400` for a wrong `iss` too, and anyone can send such a request. Add an error handler to choose what the browser sees and what is logged, and to log the original error:

```ts
import { PoppyErrorCode } from '@auth0/auth0-express';
import type { NextFunction, Request, Response } from 'express';

// The SDK gives each of these codes a fixed text with no value of a token or a request in it, so it is safe to show.
const SHOWN_CODES = new Set<string>([...Object.values(PoppyErrorCode), 'session_expired']);

// After the router and your routes. Express treats a function with four parameters as an error handler.
// This sample maps every error other than a refusal of the SDK (a `403`, or the `400` of the login route) to 500.
// Keep your own mapping for other statuses.
app.use((error: Error & { status?: number; code?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  // The original error is on `cause`. Log it, and do not send it to the browser.
  console.error(error.message, error.cause);

  // A guest is in the browser. Tell the person what to do, and do not send the browser to the login route: the same
  // login would be refused again.
  if (error.code === PoppyErrorCode.SIGN_IN_REQUIRED) {
    res.status(403).send('An agent is using this browser. <a href="/auth/logout">Log out</a> first, and then sign in.');
    return;
  }

  // A login link that names another issuer. The SDK gives it a fixed text, so it is safe to show.
  if (error.status === 400 && error.code === 'issuer_validation_error') {
    res.status(400).type('text/plain').send(error.message);
    return;
  }

  // Send the message only for a code of the SDK, and as plain text. The message of any other error may hold a value
  // from a request, and `res.send()` of a string would send it as HTML.
  if (error.status === 403 && error.code && SHOWN_CODES.has(error.code)) {
    res.status(403).type('text/plain').send(error.message);
    return;
  }

  res.status(500).type('text/plain').send('Something went wrong.');
});
```

### Test the join without a tenant

The example's [`src/app.spec.ts`](../../examples/example-express-web-poppy/src/app.spec.ts) runs the whole join with no Auth0 tenant and no network:

- `msw` plays the tenant. It answers the metadata request and the token endpoint, and the token endpoint returns the ID token that the test sets next.
- The test signs its ID tokens with a key that it generates.
- A cookie jar plays the browser. It carries the cookies from the login route to the callback route, and on to your routes.

A test sends `GET /auth/login` with `iss` and `target_link_uri`, sets the ID token, sends `GET /auth/callback?code=abc`, and then asks your routes, with the cookies. A guest and a signed-in agent differ only in the claims of their ID token:

```ts
// The `act` claim that Auth0 adds after an agent's browser has joined a Poppy Session.
const act = {
  sub: 'https://agent.example/agent.json', // the agent's client ID: the URL of its client metadata document
  poppy_sid: 'Yx2b7Qd_Kp8mR3vT1nWc4A', // the ID of the Poppy Session
  poppy_user_id: 'usr_Q7c1vK', // the user, as the Personal Agent knows them
};

// A guest: the user of the agent has not signed in.
const guestClaims = {
  sub: 'anon_poppy@z4eHq6gTjlgaMSjrplb3j5j3kb3hEDz9hZx8mgdxQLg',
  sub_profile: 'user urn:auth0:anonymous_user',
  act,
};

// A signed-in agent: a normal `sub` for the user, and the same `act`.
const signedInClaims = { sub: 'auth0|ana', act };
```

### Custom guest store

The built-in `StatelessPoppyGuestStore` keeps the guest in an encrypted cookie. To keep guests in a database or a cache, pass your own `PoppyGuestStore` as `poppy.guestStore`. The store must tell one browser from another, and the package gives it what it needs: every call of the store gets `{ request, response }` as its last argument, the Express request and response of the browser. The first call that writes a guest is the callback, so the store sets its own browser id on `response` there.

```ts
import { randomUUID } from 'node:crypto';
import type { PoppyGuestData, PoppyGuestStore, StoreOptions } from '@auth0/auth0-express';

// `__Host-` makes a browser refuse this cookie from a sibling host, so another site on your domain cannot plant an id.
const BROWSER_COOKIE = '__Host-guest_browser';

// Replace the Map with your database, and give each record a time to live that ends at `expiresAt`.
const records = new Map<string, PoppyGuestData>();

const browserOf = (options?: StoreOptions): string | undefined => options?.request.cookies?.[BROWSER_COOKIE];

const guestStore: PoppyGuestStore<StoreOptions> = {
  async set(identifier, guest, _removeIfExists, options) {
    const seconds = guest.expiresAt - Math.floor(Date.now() / 1000);
    const previous = browserOf(options);

    // The id changes every time a guest is written, and the record under the old id goes.
    if (previous) {
      records.delete(`${previous}:${identifier}`);
    }

    // Keep nothing past `expiresAt`.
    if (seconds <= 0) {
      return;
    }

    // An id that your server issues and nobody can guess.
    const browser = randomUUID();
    options?.response.cookie(BROWSER_COOKIE, browser, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: seconds * 1000,
    });

    records.set(`${browser}:${identifier}`, guest);
  },

  async get(identifier, options) {
    const browser = browserOf(options);
    const guest = browser ? records.get(`${browser}:${identifier}`) : undefined;

    // A record that has ended is no guest.
    return guest && guest.expiresAt > Math.floor(Date.now() / 1000) ? guest : undefined;
  },

  async delete(identifier, options) {
    const browser = browserOf(options);

    if (browser) {
      records.delete(`${browser}:${identifier}`);
    }

    // A browser ignores the header that clears a `__Host-` cookie unless it has `Secure`, so give it the same attributes.
    options?.response.clearCookie(BROWSER_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  },
};

app.use(createAuth0({
  // ...
  poppy: { guestStore },
}));
```

The rules for the store:

- **Key a record on a browser id that your server issued, never on `identifier` alone.** `identifier` is the same for every visitor. A store that uses only it gives the first guest to every browser of your site, with its access token, and refuses every person's login. Never use a value that the visitor can choose, or whoever sends the id gets the guest. Issue a new id each time a guest is written, as the sample does, and clear the old record.
- **Give the id cookie the `__Host-` prefix** (`Secure`, `Path=/`, no `Domain`), as the sample does, so that another site on your domain cannot plant an id of its own. Clear it with the same `secure`, `path` and `httpOnly` attributes, or a browser ignores the clearing header.
- **Protect the record like a session.** It holds the access token of the join. A `Map` is for the sample only. In a database, encrypt the record (extend `AbstractPoppyGuestStore` and use `this.encrypt()` and `this.decrypt()`, as `StatelessPoppyGuestStore` does) or keep the token out of the record.
- **Never keep a record past its `expiresAt`** (Unix time, in seconds). The SDK checks `expiresAt` on every read too, so this only keeps your store clean.
- **Return `undefined` from `get()` for a record you cannot use.** An error from your store reaches your code and is never read as an empty store. When you encrypt records, extend `AbstractPoppyGuestStore`, which this package exports, and let the `ERR_JWT_EXPIRED` error of an expired value through, as `StatelessPoppyGuestStore` does. The [server-js documentation](https://github.com/auth0/auth0-auth-js/blob/main/packages/auth0-server-js/EXAMPLES.md) has a complete example.

### Poppy in production

- **Use a static `appBaseUrl`.** In [dynamic mode](#dynamic-application-base-urls), where you leave `appBaseUrl` out, the landing page of a join is checked against the host of the request, as `returnTo` is.
- **Serve the site over HTTPS, at the root of `organization.domain`.** The guest cookie is `Secure`. For local development over plain HTTP, set `poppy.cookie.secure` to `false`.
- **Trust the other hosts of your domain.** The guest cookie has the `__Host-` prefix, so a sibling host cannot plant one. The cookies of the login transaction and of the session have no such prefix, so a host on a sibling subdomain, or an attacker on plain HTTP, can plant one of them in a visitor's browser and finish a login of the attacker's own there. Serve every subdomain over HTTPS, and send `Strict-Transport-Security` with `includeSubDomains`.
- **Mount the router before any middleware that sets cookies.** The two discovery files carry `cache-control: public, max-age=300`, so a shared cache could keep a cookie that rides on them. The router removes a `Set-Cookie` header that earlier middleware has already set on these two responses. It cannot remove a cookie that a middleware adds when the response ends, as `express-session` does, so keep such middleware behind the router.
- **Do not let a shared cache keep an answer for one visitor.** The two discovery files are public. Every other answer depends on the cookies of the visitor, so send `Cache-Control: no-store` for them, as the [example](../../examples/example-express-web-poppy) does, or a CDN with a default time to live could give the page of one visitor to another.
- **Deploy `poppy.json` with the app,** or point `configPath` at it. It is read once, at startup.
- **Plan for secret rotation.** Guests are encrypted with `sessionSecret`. A secret array such as `[newSecret, oldSecret]` rotates them as it does sessions. When you drop the old secret, the guests that it encrypted are gone.
- **Know the limits of the beta.** The support in this package is a beta. The join has not been proven end to end against a live Auth0 tenant, so test it on your tenant before you rely on it.
- **A sign-out or a disconnect on the Auth0 side is not seen.** The SDK does not see a sign-out or a disconnect on Auth0's side, whichever store you use. A guest, or the session of a signed-in agent, lasts until its deadline: at most `agentSessionMaxAge` seconds after the login, which is two hours by default. No read extends it, but a new login starts a new deadline, so after a session has ended the same Session can sign in again through the login route while Auth0's own session for the agent still lives.
- **A signed-in agent's token is your web app's token.** Auth0 narrows its access token to the scopes of the agent when your login route asks for the right audience (see [The audience of your login route](#the-audience-of-your-login-route)), and an Action can still add scopes to it. The ID token and the claims of the session are not narrowed, and `requiresAuth()` checks no scopes, so either set `web.unscoped` to `true` or check the scopes in your routes (see [Scopes](#scopes)).
- **Neither a guest nor a signed-in agent has a refresh token.** The access token is never refreshed.
