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
  - [Using requireAuth middleware](#using-requireauth-middleware)
  - [Using custom middleware](#using-custom-middleware)
- [Authorization with Claims](#authorization-with-claims)
  - [Using claimEquals](#using-claimequals)
  - [Using claimIncludes](#using-claimincludes)
  - [Using claimCheck for custom logic](#using-claimcheck-for-custom-logic)
- [Requesting an Access Token to call an API](#requesting-an-access-token-to-call-an-api)
- [Multiple Custom Domains (MCD)](#multiple-custom-domains-mcd)

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

### Using requireAuth middleware

The SDK provides a `requireAuth` middleware that automatically protects routes and handles authentication redirects:

```ts
import { requireAuth } from '@auth0/auth0-express';

// Protect a route - redirects to login if not authenticated
app.get('/profile', requireAuth(), async (req, res) => {
  const user = await req.auth0.client.getUser();
  res.render('profile.ejs', { name: user!.name });
});

// For API routes - returns 401 instead of redirecting
app.get('/api/me', requireAuth(), async (req, res) => {
  const user = await req.auth0.client.getUser();
  res.json({ user });
});

// Custom return URL after login
app.get('/admin', requireAuth({ returnTo: '/admin/dashboard' }), (req, res) => {
  res.send('Admin page');
});
```

The `requireAuth` middleware automatically:
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
import { claimEquals, requireAuth } from '@auth0/auth0-express';

// Only allow users with role 'admin'
app.get('/admin',
  requireAuth(),
  claimEquals('role', 'admin'),
  (req, res) => {
    res.send('Admin dashboard');
  }
);

// Check a namespace claim
app.get('/internal',
  requireAuth(),
  claimEquals('https://myapp.com/department', 'engineering'),
  (req, res) => {
    res.send('Engineering portal');
  }
);
```

By default, `claimEquals` checks the ID token claims. You can specify to check access token claims instead:

```ts
app.get('/admin',
  requireAuth(),
  claimEquals('role', 'admin', { tokenType: 'access' }),
  (req, res) => {
    res.send('Admin dashboard');
  }
);
```

### Using claimIncludes

Check if a claim array includes a specific value, useful for permissions:

```ts
import { claimIncludes, requireAuth } from '@auth0/auth0-express';

// Check if user has 'delete:users' permission
app.delete('/users/:id',
  requireAuth(),
  claimIncludes('permissions', 'delete:users'),
  async (req, res) => {
    // Delete user logic
    res.json({ success: true });
  }
);

// Check for multiple permissions (user needs at least one)
app.get('/admin/users',
  requireAuth(),
  claimIncludes('permissions', ['read:users', 'admin:all']),
  (req, res) => {
    res.render('users-list');
  }
);
```

### Using claimCheck for custom logic

For complex authorization rules, use `claimCheck` with a custom validation function:

```ts
import { claimCheck, requireAuth } from '@auth0/auth0-express';

// Check multiple conditions
app.get('/premium',
  requireAuth(),
  claimCheck((claims) => {
    return claims.subscription === 'premium' && claims.email_verified === true;
  }),
  (req, res) => {
    res.render('premium-content');
  }
);

// Check if user is in specific organization with required role
app.get('/org/:orgId/settings',
  requireAuth(),
  claimCheck((claims, req) => {
    const orgId = req.params.orgId;
    return claims.org_id === orgId && claims.org_role === 'owner';
  }),
  (req, res) => {
    res.render('org-settings');
  }
);

// Check access token claims
app.post('/api/admin',
  requireAuth(),
  claimCheck((claims) => {
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