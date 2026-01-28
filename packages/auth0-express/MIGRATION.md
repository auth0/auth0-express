# Migrating from express-openid-connect to auth0-express

This guide will help you migrate your Express.js application from `express-openid-connect` to `@auth0/auth0-express`.

## Overview

`@auth0/auth0-express` is a modern, redesigned authentication SDK for Express.js applications that provides:

- **Simplified configuration** - Fewer required options with sensible defaults
- **TypeScript-first** - Built with TypeScript for better type safety and IDE support
- **Modular architecture** - Separate packages for web apps (`@auth0/auth0-express`) and APIs (`@auth0/auth0-express-api`)
- **Improved developer experience** - Cleaner APIs and better async/await support
- **Audit trail support** - Built-in AsyncLocalStorage for tracking request context

## Installation

First, install the new package:

```bash
npm uninstall express-openid-connect
npm install @auth0/auth0-express
```

## Basic Configuration Migration

### express-openid-connect (Before)

```javascript
const express = require('express');
const { auth } = require('express-openid-connect');

const app = express();

app.use(
  auth({
    issuerBaseURL: 'https://YOUR_DOMAIN',
    baseURL: 'https://YOUR_APPLICATION_ROOT_URL',
    clientID: 'YOUR_CLIENT_ID',
    secret: 'LONG_RANDOM_STRING',
    idpLogout: true,
  })
);
```

### @auth0/auth0-express (After)

```javascript
const express = require('express');
const { createAuth0Router } = require('@auth0/auth0-express');

const app = express();

app.use(
  createAuth0Router({
    domain: 'YOUR_DOMAIN', // Without https:// prefix
    clientId: 'YOUR_CLIENT_ID',
    clientSecret: 'YOUR_CLIENT_SECRET',
    appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
    sessionSecret: 'LONG_RANDOM_STRING',
  })
);
```

## Key Configuration Changes

### 1. Configuration Property Mapping

| express-openid-connect | @auth0/auth0-express | Notes |
|------------------------|----------------------|-------|
| `issuerBaseURL` | `domain` | Remove `https://` prefix in new SDK |
| `baseURL` | `appBaseUrl` | Renamed for clarity |
| `clientID` | `clientId` | Camel case |
| `secret` | `sessionSecret` | Renamed for clarity |
| `clientSecret` | `clientSecret` | Required in new SDK |
| `idpLogout` | *(built-in)* | IDP logout is now default behavior |

### 2. Environment Variables

#### express-openid-connect (Before)
```bash
ISSUER_BASE_URL=https://YOUR_DOMAIN
BASE_URL=https://YOUR_APPLICATION_ROOT_URL
CLIENT_ID=YOUR_CLIENT_ID
SECRET=LONG_RANDOM_VALUE
```

#### @auth0/auth0-express (After)
```bash
AUTH0_DOMAIN=YOUR_DOMAIN
APP_BASE_URL=https://YOUR_APPLICATION_ROOT_URL
AUTH0_CLIENT_ID=YOUR_CLIENT_ID
AUTH0_CLIENT_SECRET=YOUR_CLIENT_SECRET
AUTH0_SESSION_SECRET=LONG_RANDOM_VALUE
```

## Routes Migration

### Default Routes

Both SDKs provide default routes, but the naming conventions differ:

| express-openid-connect | @auth0/auth0-express |
|------------------------|----------------------|
| `/login` | `/auth/login` |
| `/logout` | `/auth/logout` |
| `/callback` | `/auth/callback` |
| *(not available)* | `/auth/backchannel-logout` |

### Custom Routes

#### express-openid-connect (Before)

```javascript
app.use(
  auth({
    routes: {
      login: '/custom/login',
      logout: '/custom/logout',
      callback: '/custom/callback',
      postLogoutRedirect: '/custom/post-logout',
    },
  })
);
```

#### @auth0/auth0-express (After)

```javascript
app.use(
  createAuth0Router({
    routes: {
      login: '/custom/login',
      logout: '/custom/logout',
      callback: '/custom/callback',
      backchannelLogout: '/custom/backchannel-logout',
    },
  })
);
```

**Note**: The new SDK doesn't have a `postLogoutRedirect` route option. After logout, users are redirected to the `appBaseUrl`.

### Disabling Default Routes

#### express-openid-connect (Before)

```javascript
app.use(
  auth({
    routes: {
      login: false,
      logout: false,
      callback: false,
    },
  })
);
```

#### @auth0/auth0-express (After)

```javascript
app.use(
  createAuth0Router({
    domain: 'YOUR_DOMAIN',
    clientId: 'YOUR_CLIENT_ID',
    clientSecret: 'YOUR_CLIENT_SECRET',
    appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
    sessionSecret: 'LONG_RANDOM_STRING',
    mountRoutes: false, // Disable all routes
  })
);
```

## Accessing User Information

### express-openid-connect (Before)

```javascript
app.get('/profile', (req, res) => {
  if (req.oidc.isAuthenticated()) {
    const user = req.oidc.user;
    const idTokenClaims = req.oidc.idTokenClaims;

    res.json({ user, claims: idTokenClaims });
  } else {
    res.status(401).send('Not authenticated');
  }
});
```

### @auth0/auth0-express (After)

```javascript
app.get('/profile', async (req, res) => {
  const user = await req.auth0.client.getUser();

  if (user) {
    res.json({ user });
  } else {
    res.status(401).send('Not authenticated');
  }
});
```

**Key Differences:**
- `getUser()` is now async and returns a Promise
- `req.oidc` becomes `req.auth0.client`
- `isAuthenticated()` is replaced by checking if `getUser()` returns a user
- User object directly contains the claims (no separate `idTokenClaims`)

## Protecting Routes

### express-openid-connect (Before)

#### Option 1: Global Authentication
```javascript
app.use(
  auth({
    authRequired: true, // Default
  })
);
```

#### Option 2: Route-specific with requiresAuth
```javascript
const { requiresAuth } = require('express-openid-connect');

app.use(
  auth({
    authRequired: false,
  })
);

app.get('/protected', requiresAuth(), (req, res) => {
  res.send('Protected content');
});
```

### @auth0/auth0-express (After)

```javascript
const { createAuth0Router } = require('@auth0/auth0-express');

app.use(
  createAuth0Router({
    domain: 'YOUR_DOMAIN',
    clientId: 'YOUR_CLIENT_ID',
    clientSecret: 'YOUR_CLIENT_SECRET',
    appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
    sessionSecret: 'LONG_RANDOM_STRING',
  })
);

// Create a middleware to protect routes
async function requireSession(req, res, next) {
  const session = await req.auth0.client.getSession();

  if (!session) {
    return res.redirect(`/auth/login?returnTo=${encodeURIComponent(req.url)}`);
  }

  next();
}

// Public route
app.get('/', async (req, res) => {
  const user = await req.auth0.client.getUser();
  res.send(user ? `Hello ${user.name}` : 'Hello guest');
});

// Protected route
app.get('/protected', requireSession, async (req, res) => {
  const user = await req.auth0.client.getUser();
  res.send(`Protected content for ${user.name}`);
});
```

**Key Differences:**
- No global `authRequired` option - all routes are public by default
- Create your own middleware for route protection
- More explicit and flexible route protection

## Custom Login Parameters

### express-openid-connect (Before)

```javascript
app.get('/login-with-google', (req, res) => {
  res.oidc.login({
    returnTo: '/profile',
    authorizationParams: {
      connection: 'google-oauth2',
      prompt: 'login',
    },
  });
});
```

### @auth0/auth0-express (After)

```javascript
app.get('/login-with-google', async (req, res) => {
  const redirectUrl = await req.auth0.client.startInteractiveLogin({
    returnTo: '/profile',
    authorizationParams: {
      connection: 'google-oauth2',
      prompt: 'login',
    },
  });

  res.redirect(redirectUrl);
});
```

**Key Differences:**
- Method is now async
- Returns a URL that you redirect to explicitly
- Parameters structure is similar but method name changed

## Custom Logout

### express-openid-connect (Before)

```javascript
app.get('/custom-logout', (req, res) => {
  res.oidc.logout({
    returnTo: '/goodbye',
  });
});
```

### @auth0/auth0-express (After)

```javascript
app.get('/custom-logout', async (req, res) => {
  const logoutUrl = await req.auth0.client.logout({
    returnTo: process.env.APP_BASE_URL + '/goodbye',
  });

  res.redirect(logoutUrl);
});
```

**Key Differences:**
- Method is now async
- Returns a URL that you redirect to explicitly
- `returnTo` must be a full URL

## Claim Validation

### express-openid-connect (Before)

```javascript
const { claimEquals, claimIncludes, claimCheck } = require('express-openid-connect');

// Check if claim equals a value
app.get('/admin', claimEquals('role', 'admin'), (req, res) => {
  res.send('Admin content');
});

// Check if claim includes a value
app.get('/editor', claimIncludes('roles', 'editor'), (req, res) => {
  res.send('Editor content');
});

// Custom claim check
app.get('/premium', claimCheck((req, claims) => {
  return claims.subscription === 'premium';
}), (req, res) => {
  res.send('Premium content');
});
```

### @auth0/auth0-express (After)

```javascript
// Create custom middleware for claim validation
async function requireClaim(claimName, expectedValue) {
  return async (req, res, next) => {
    const user = await req.auth0.client.getUser();

    if (!user || user[claimName] !== expectedValue) {
      return res.status(403).send('Forbidden');
    }

    next();
  };
}

async function requireClaimIncludes(claimName, expectedValue) {
  return async (req, res, next) => {
    const user = await req.auth0.client.getUser();

    if (!user || !Array.isArray(user[claimName]) || !user[claimName].includes(expectedValue)) {
      return res.status(403).send('Forbidden');
    }

    next();
  };
}

// Usage
app.get('/admin', await requireClaim('role', 'admin'), (req, res) => {
  res.send('Admin content');
});

app.get('/editor', await requireClaimIncludes('roles', 'editor'), (req, res) => {
  res.send('Editor content');
});
```

**Key Differences:**
- No built-in claim validation middleware
- Create your own middleware functions
- More flexible but requires more code

## Session Configuration

### express-openid-connect (Before)

```javascript
app.use(
  auth({
    session: {
      name: 'myapp_session',
      rolling: true,
      rollingDuration: 86400,
      absoluteDuration: 604800,
      cookie: {
        domain: '.example.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
      },
    },
  })
);
```

### @auth0/auth0-express (After)

```javascript
app.use(
  createAuth0Router({
    domain: 'YOUR_DOMAIN',
    clientId: 'YOUR_CLIENT_ID',
    clientSecret: 'YOUR_CLIENT_SECRET',
    appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
    sessionSecret: 'LONG_RANDOM_STRING',
    sessionConfiguration: {
      name: 'myapp_session',
      rolling: true,
      rollingDuration: 86400,
      absoluteDuration: 604800,
      cookie: {
        domain: '.example.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
      },
    },
  })
);
```

**Key Differences:**
- Wrapped in `sessionConfiguration` object
- Same properties are supported

## Custom Session Store (Stateful Sessions)

### express-openid-connect (Before)

```javascript
const { auth } = require('express-openid-connect');

class MySessionStore {
  async get(sid) {
    // Retrieve session from database
  }

  async set(sid, val) {
    // Store session in database
  }

  async destroy(sid) {
    // Delete session from database
  }
}

app.use(
  auth({
    session: {
      store: new MySessionStore(),
    },
  })
);
```

### @auth0/auth0-express (After)

```javascript
const { createAuth0Router } = require('@auth0/auth0-express');

class MySessionStore {
  async get(identifier) {
    // Retrieve session from database
  }

  async set(identifier, stateData) {
    // Store session in database
  }

  async delete(identifier) {
    // Delete session from database
  }

  async deleteByLogoutToken(claims, options) {
    // Handle backchannel logout
    // Delete sessions matching the sub/sid in claims
  }
}

app.use(
  createAuth0Router({
    domain: 'YOUR_DOMAIN',
    clientId: 'YOUR_CLIENT_ID',
    clientSecret: 'YOUR_CLIENT_SECRET',
    appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
    sessionSecret: 'LONG_RANDOM_STRING',
    sessionStore: new MySessionStore(),
  })
);
```

**Key Differences:**
- Method name `destroy` becomes `delete`
- Added `deleteByLogoutToken` method for backchannel logout support
- Parameter names differ slightly

## Accessing APIs with Access Tokens

### express-openid-connect (Before)

```javascript
const { auth } = require('express-openid-connect');
const axios = require('axios');

app.use(
  auth({
    authorizationParams: {
      audience: 'https://api.example.com',
      scope: 'openid profile email read:products',
    },
  })
);

app.get('/products', async (req, res) => {
  const { access_token } = req.oidc.accessToken;

  const response = await axios.get('https://api.example.com/products', {
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
  });

  res.json(response.data);
});
```

### @auth0/auth0-express (After)

```javascript
const { createAuth0Router } = require('@auth0/auth0-express');
const axios = require('axios');

app.use(
  createAuth0Router({
    domain: 'YOUR_DOMAIN',
    clientId: 'YOUR_CLIENT_ID',
    clientSecret: 'YOUR_CLIENT_SECRET',
    appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
    sessionSecret: 'LONG_RANDOM_STRING',
    audience: 'https://api.example.com',
  })
);

app.get('/products', async (req, res) => {
  const session = await req.auth0.client.getSession();

  if (!session || !session.tokenSets || session.tokenSets.length === 0) {
    return res.redirect('/auth/login');
  }

  // Access tokens are stored in tokenSets array
  const accessToken = session.tokenSets[0].accessToken;

  const response = await axios.get('https://api.example.com/products', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  res.json(response.data);
});
```

**Key Differences:**
- Configure `audience` at the root level
- Access tokens are retrieved from `session.tokenSets[0].accessToken`
- Each token set contains an `accessToken`, `audience`, `scope`, and `expiresAt`
- Access token refresh is handled automatically by the SDK

## Backchannel Logout

Backchannel logout is supported in both SDKs but with different configurations.

### express-openid-connect (Before)

```javascript
app.use(
  auth({
    backchannelLogout: {
      store: myCustomStore,
    },
  })
);
```

### @auth0/auth0-express (After)

Backchannel logout is automatically enabled when you provide a custom session store with the `deleteByLogoutToken` method:

```javascript
class MySessionStore {
  async get(identifier) { /* ... */ }
  async set(identifier, stateData) { /* ... */ }
  async delete(identifier) { /* ... */ }

  async deleteByLogoutToken(claims, options) {
    // Handle backchannel logout by deleting sessions
    // matching the sub/sid in the logout token claims
    const { sub, sid } = claims;

    // Delete sessions for this user
    await this.deleteSessionsBySubAndSid(sub, sid);
  }
}

app.use(
  createAuth0Router({
    domain: 'YOUR_DOMAIN',
    clientId: 'YOUR_CLIENT_ID',
    clientSecret: 'YOUR_CLIENT_SECRET',
    appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
    sessionSecret: 'LONG_RANDOM_STRING',
    sessionStore: new MySessionStore(),
  })
);
```

The backchannel logout endpoint is available at `/auth/backchannel-logout` by default (or configure with `routes.backchannelLogout`).

## Silent Authentication

### express-openid-connect (Before)

```javascript
const { attemptSilentLogin } = require('express-openid-connect');

app.use(
  auth({
    authRequired: false,
  })
);

app.get('/', attemptSilentLogin(), (req, res) => {
  if (req.oidc.isAuthenticated()) {
    res.send(`Hello ${req.oidc.user.name}`);
  } else {
    res.send('Hello guest');
  }
});
```

### @auth0/auth0-express (After)

Silent authentication is not currently available as a built-in feature. For similar functionality, you would need to implement it using the Auth0 API directly with `prompt=none`.

## Not Migrated (Advanced Features)

The following features from `express-openid-connect` are not currently available in `@auth0/auth0-express`:

1. **attemptSilentLogin** - Silent authentication middleware
2. **Pushed Authorization Requests (PAR)** - Configured via `pushedAuthorizationRequests` option but behavior may differ
3. **Transient cookies** - Different cookie management approach
4. **afterCallback hook** - Use Express middleware after the callback route instead

## TypeScript Support

`@auth0/auth0-express` is built with TypeScript and provides full type definitions out of the box.

### TypeScript Example

```typescript
import express, { Request, Response, NextFunction } from 'express';
import { createAuth0Router } from '@auth0/auth0-express';

const app = express();

app.use(
  createAuth0Router({
    domain: process.env.AUTH0_DOMAIN as string,
    clientId: process.env.AUTH0_CLIENT_ID as string,
    clientSecret: process.env.AUTH0_CLIENT_SECRET as string,
    appBaseUrl: process.env.APP_BASE_URL as string,
    sessionSecret: process.env.AUTH0_SESSION_SECRET as string,
  })
);

async function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = await req.auth0.client.getSession();

  if (!session) {
    return res.redirect(`/auth/login?returnTo=${encodeURIComponent(req.url)}`);
  }

  next();
}

app.get('/profile', requireSession, async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  res.json({ user });
});
```

## Summary of Breaking Changes

1. **Package name** - `express-openid-connect` → `@auth0/auth0-express`
2. **Import** - `auth` function → `createAuth0Router` function
3. **Configuration**:
   - `issuerBaseURL` → `domain` (remove https:// prefix)
   - `baseURL` → `appBaseUrl`
   - `clientID` → `clientId`
   - `secret` → `sessionSecret`
   - `clientSecret` is now required
4. **Request object** - `req.oidc` → `req.auth0.client`
5. **Methods are async** - Most methods now return Promises
6. **No built-in middlewares** - `requiresAuth()`, `claimCheck()`, etc. need to be implemented manually
7. **Route protection** - No global `authRequired` option, create custom middleware
8. **Default routes** - Prefixed with `/auth/` instead of root level
9. **No response helpers** - `res.oidc.login()`, `res.oidc.logout()`, `res.oidc.callback()` are removed

## Getting Help

- [Auth0 Community](https://community.auth0.com)
- [GitHub Issues](https://github.com/auth0/auth0-express/issues)
- [Documentation](https://github.com/auth0/auth0-express)

## Next Steps

After migrating your basic configuration:

1. Test your login and logout flows
2. Verify protected routes work correctly
3. Test any custom session store implementation
4. Update your tests to work with the new async API
5. Gradually migrate advanced features

Remember to thoroughly test your authentication flows in a development environment before deploying to production.
