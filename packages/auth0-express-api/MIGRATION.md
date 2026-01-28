# Migrating from express-oauth2-jwt-bearer to @auth0/auth0-express-api

This guide will help you migrate your Express.js API from `express-oauth2-jwt-bearer` to `@auth0/auth0-express-api`.

## Overview

`@auth0/auth0-express-api` is a modern, redesigned API authentication middleware for Express.js that provides:

- **Simplified architecture** - Cleaner separation of concerns with a router-based approach
- **TypeScript-first** - Built with TypeScript for better type safety
- **Modern async patterns** - Better async/await support
- **Improved developer experience** - More explicit middleware usage
- **Audit trail support** - Built-in request context tracking with AsyncLocalStorage

## Installation

First, install the new package:

```bash
npm uninstall express-oauth2-jwt-bearer
npm install @auth0/auth0-express-api
```

## Basic Configuration Migration

### express-oauth2-jwt-bearer (Before)

```javascript
const express = require('express');
const { auth } = require('express-oauth2-jwt-bearer');

const app = express();

app.use(
  auth({
    issuerBaseURL: 'https://YOUR_DOMAIN',
    audience: 'https://myapi.com',
  })
);

app.get('/api/messages', (req, res) => {
  res.json({ message: 'Protected API' });
});
```

### @auth0/auth0-express-api (After)

```javascript
const express = require('express');
const { createAuth0ApiRouter } = require('@auth0/auth0-express-api');

const app = express();

app.use(
  createAuth0ApiRouter({
    domain: 'YOUR_DOMAIN', // Without https:// prefix
    audience: 'https://myapi.com',
  })
);

app.get('/api/messages', (req, res, next) => {
  res.locals.requireAuth()(req, res, next);
}, (req, res) => {
  res.json({ message: 'Protected API' });
});
```

## Key Configuration Changes

### 1. Configuration Property Mapping

| express-oauth2-jwt-bearer | @auth0/auth0-express-api | Notes |
|---------------------------|--------------------------|-------|
| `issuerBaseURL` | `domain` | Remove `https://` prefix |
| `audience` | `audience` | Same |
| `authRequired` | *(middleware-based)* | Use `requireAuth()` middleware per route |
| `jwksUri` | *(auto-discovered)* | Automatically discovered from domain |
| `issuer` | *(auto-discovered)* | Automatically discovered from domain |

### 2. Environment Variables

#### express-oauth2-jwt-bearer (Before)
```bash
ISSUER_BASE_URL=https://YOUR_DOMAIN
AUDIENCE=https://myapi.com
```

#### @auth0/auth0-express-api (After)
```bash
AUTH0_DOMAIN=YOUR_DOMAIN
AUTH0_AUDIENCE=https://myapi.com
```

## Global vs Per-Route Authentication

### express-oauth2-jwt-bearer (Before)

In the old SDK, authentication was applied globally by default:

```javascript
// All routes require authentication
app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
}));

app.get('/api/public', (req, res) => {
  res.json({ message: 'This is actually protected!' });
});
```

To make routes optional:

```javascript
// Make authentication optional
app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
  authRequired: false, // Makes all routes optional
}));

app.get('/api/public', (req, res) => {
  if (req.auth) {
    res.json({ message: `Hello ${req.auth.payload.sub}` });
  } else {
    res.json({ message: 'Hello guest' });
  }
});
```

### @auth0/auth0-express-api (After)

In the new SDK, **all routes are public by default**. You must explicitly protect routes:

```javascript
app.use(
  createAuth0ApiRouter({
    domain: 'YOUR_DOMAIN',
    audience: 'https://myapi.com',
  })
);

// Public route - no authentication required
app.get('/api/public', (req, res) => {
  res.json({ message: 'Hello guest' });
});

// Protected route - requires authentication
app.get('/api/private', (req, res, next) => {
  res.locals.requireAuth()(req, res, next);
}, (req, res) => {
  res.json({ message: `Hello ${req.auth0.user.sub}` });
});
```

**Key Difference:** The default behavior is reversed. This makes it more explicit which routes are protected.

## Accessing Token Information

### express-oauth2-jwt-bearer (Before)

```javascript
app.get('/api/profile', (req, res) => {
  const auth = req.auth;

  res.json({
    header: auth.header,   // JWT header
    payload: auth.payload, // JWT payload (claims)
    token: auth.token,     // Raw JWT string
  });
});
```

### @auth0/auth0-express-api (After)

```javascript
app.get('/api/profile', (req, res, next) => {
  res.locals.requireAuth()(req, res, next);
}, (req, res) => {
  const user = req.auth0.user;

  res.json({
    user: user, // User claims (same as auth.payload in old SDK)
  });
});
```

**Key Differences:**
- `req.auth` becomes `req.auth0.user`
- `req.auth.payload` becomes `req.auth0.user`
- The raw token and header are not directly exposed
- User object contains all JWT claims

## Protecting Routes with Scopes

### express-oauth2-jwt-bearer (Before)

```javascript
const { auth, requiredScopes } = require('express-oauth2-jwt-bearer');

app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
}));

// Requires ALL specified scopes
app.get('/api/admin',
  requiredScopes('read:admin write:admin'),
  (req, res) => {
    res.json({ message: 'Admin content' });
  }
);
```

### @auth0/auth0-express-api (After)

```javascript
const { createAuth0ApiRouter } = require('@auth0/auth0-express-api');

const auth0Router = createAuth0ApiRouter({
  domain: 'YOUR_DOMAIN',
  audience: 'https://myapi.com',
});

app.use(auth0Router);

// Requires ALL specified scopes (space-separated or array)
app.get('/api/admin', (req, res, next) => {
  res.locals.requireAuth({ scopes: 'read:admin write:admin' })(req, res, next);
}, (req, res) => {
  res.json({ message: 'Admin content' });
});

// Or using array syntax
app.get('/api/admin', (req, res, next) => {
  res.locals.requireAuth({ scopes: ['read:admin', 'write:admin'] })(req, res, next);
}, (req, res) => {
  res.json({ message: 'Admin content' });
});
```

**Key Differences:**
- No separate `requiredScopes()` function
- Scopes are passed as options to `requireAuth()`
- Can use space-separated string or array

## Scope Validation: Any vs All

### express-oauth2-jwt-bearer (Before)

```javascript
const { auth, requiredScopes, scopeIncludesAny } = require('express-oauth2-jwt-bearer');

app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
}));

// Requires ALL scopes
app.get('/api/admin-full',
  requiredScopes('read:admin write:admin'),
  (req, res) => {
    res.json({ message: 'Full admin' });
  }
);

// Requires ANY of the scopes
app.get('/api/admin-any',
  scopeIncludesAny('read:admin write:admin'),
  (req, res) => {
    res.json({ message: 'Partial admin' });
  }
);
```

### @auth0/auth0-express-api (After)

```javascript
const auth0Router = createAuth0ApiRouter({
  domain: 'YOUR_DOMAIN',
  audience: 'https://myapi.com',
});

app.use(auth0Router);

// Requires ALL scopes (default behavior)
app.get('/api/admin-full', (req, res, next) => {
  res.locals.requireAuth({ scopes: 'read:admin write:admin' })(req, res, next);
}, (req, res) => {
  res.json({ message: 'Full admin' });
});

// For ANY scope behavior, create custom middleware
function requireAnyScope(...scopes) {
  return (req, res, next) => {
    // First ensure authentication
    res.locals.requireAuth()(req, res, (err) => {
      if (err) return next(err);

      const userScopes = req.auth0.user.scope?.split(' ') || [];
      const hasAnyScope = scopes.some(scope => userScopes.includes(scope));

      if (!hasAnyScope) {
        return res.status(403).json({
          error: 'insufficient_scope',
          error_description: 'Insufficient scopes',
        });
      }

      next();
    });
  };
}

app.get('/api/admin-any',
  requireAnyScope('read:admin', 'write:admin'),
  (req, res) => {
    res.json({ message: 'Partial admin' });
  }
);
```

**Key Differences:**
- Only "require all scopes" is built-in
- "Any scope" requires custom middleware
- More explicit control over scope validation

## Claim Validation

### express-oauth2-jwt-bearer (Before)

```javascript
const { auth, claimEquals, claimIncludes, claimCheck } = require('express-oauth2-jwt-bearer');

app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
}));

// Check if claim equals a value
app.get('/api/admin', claimEquals('role', 'admin'), (req, res) => {
  res.json({ message: 'Admin content' });
});

// Check if claim includes values
app.get('/api/editor', claimIncludes('permissions', 'edit', 'publish'), (req, res) => {
  res.json({ message: 'Editor content' });
});

// Custom claim check
app.get('/api/premium', claimCheck((payload) => {
  return payload.subscription === 'premium' && payload.isActive;
}, 'Invalid subscription'), (req, res) => {
  res.json({ message: 'Premium content' });
});
```

### @auth0/auth0-express-api (After)

```javascript
const auth0Router = createAuth0ApiRouter({
  domain: 'YOUR_DOMAIN',
  audience: 'https://myapi.com',
});

app.use(auth0Router);

// Create custom middleware for claim validation
function claimEquals(claim, expectedValue) {
  return (req, res, next) => {
    res.locals.requireAuth()(req, res, (err) => {
      if (err) return next(err);

      if (req.auth0.user[claim] !== expectedValue) {
        return res.status(401).json({
          error: 'invalid_token',
          error_description: `Unexpected '${claim}' value`,
        });
      }

      next();
    });
  };
}

function claimIncludes(claim, ...expectedValues) {
  return (req, res, next) => {
    res.locals.requireAuth()(req, res, (err) => {
      if (err) return next(err);

      let claimValue = req.auth0.user[claim];
      if (typeof claimValue === 'string') {
        claimValue = claimValue.split(' ');
      }

      if (!Array.isArray(claimValue)) {
        return res.status(401).json({
          error: 'invalid_token',
          error_description: `Unexpected '${claim}' value`,
        });
      }

      const hasAllValues = expectedValues.every(v => claimValue.includes(v));
      if (!hasAllValues) {
        return res.status(401).json({
          error: 'invalid_token',
          error_description: `Unexpected '${claim}' value`,
        });
      }

      next();
    });
  };
}

function claimCheck(fn, errorMessage = 'Invalid token') {
  return (req, res, next) => {
    res.locals.requireAuth()(req, res, (err) => {
      if (err) return next(err);

      if (!fn(req.auth0.user)) {
        return res.status(401).json({
          error: 'invalid_token',
          error_description: errorMessage,
        });
      }

      next();
    });
  };
}

// Usage examples
app.get('/api/admin', claimEquals('role', 'admin'), (req, res) => {
  res.json({ message: 'Admin content' });
});

app.get('/api/editor', claimIncludes('permissions', 'edit', 'publish'), (req, res) => {
  res.json({ message: 'Editor content' });
});

app.get('/api/premium', claimCheck((user) => {
  return user.subscription === 'premium' && user.isActive;
}, 'Invalid subscription'), (req, res) => {
  res.json({ message: 'Premium content' });
});
```

**Key Differences:**
- No built-in claim validation middleware
- Create your own middleware functions
- More flexible but requires more code
- All custom middleware should call `requireAuth()` first

## Optional Authentication (Public Routes with Optional Auth)

### express-oauth2-jwt-bearer (Before)

```javascript
app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
  authRequired: false,
}));

app.get('/api/content', (req, res) => {
  if (req.auth) {
    res.json({
      message: 'Personalized content',
      user: req.auth.payload.sub,
    });
  } else {
    res.json({ message: 'Generic content' });
  }
});
```

### @auth0/auth0-express-api (After)

```javascript
const auth0Router = createAuth0ApiRouter({
  domain: 'YOUR_DOMAIN',
  audience: 'https://myapi.com',
});

app.use(auth0Router);

app.get('/api/content', (req, res) => {
  // Try to get user, but don't require it
  const user = req.auth0.user;

  if (user) {
    res.json({
      message: 'Personalized content',
      user: user.sub,
    });
  } else {
    res.json({ message: 'Generic content' });
  }
});
```

**Key Differences:**
- Check `req.auth0.user` directly (it will be `undefined` if not authenticated)
- No need for `authRequired: false` option
- Simpler and more explicit

## Error Handling

### express-oauth2-jwt-bearer (Before)

```javascript
const {
  auth,
  UnauthorizedError,
  InvalidTokenError,
  InsufficientScopeError
} = require('express-oauth2-jwt-bearer');

app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
}));

// Error handler
app.use((err, req, res, next) => {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
    });
  } else {
    next(err);
  }
});
```

### @auth0/auth0-express-api (After)

```javascript
const auth0Router = createAuth0ApiRouter({
  domain: 'YOUR_DOMAIN',
  audience: 'https://myapi.com',
});

app.use(auth0Router);

// Error handler (same pattern)
app.use((err, req, res, next) => {
  if (err.status === 401 || err.status === 403) {
    res.status(err.status).json({
      error: err.error || 'unauthorized',
      error_description: err.error_description || err.message,
    });
  } else {
    next(err);
  }
});
```

**Key Differences:**
- Error structure is similar
- Check `err.status` instead of `instanceof`
- Error properties: `error` and `error_description`

## TypeScript Support

### express-oauth2-jwt-bearer (Before)

```typescript
import express, { Request, Response } from 'express';
import { auth, AuthResult } from 'express-oauth2-jwt-bearer';

const app = express();

app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
}));

app.get('/api/profile', (req: Request, res: Response) => {
  const auth: AuthResult = req.auth!;
  res.json({ user: auth.payload });
});
```

### @auth0/auth0-express-api (After)

```typescript
import express, { Request, Response, NextFunction } from 'express';
import { createAuth0ApiRouter } from '@auth0/auth0-express-api';

const app = express();

const auth0Router = createAuth0ApiRouter({
  domain: process.env.AUTH0_DOMAIN as string,
  audience: process.env.AUTH0_AUDIENCE as string,
});

app.use(auth0Router);

app.get('/api/profile', (req: Request, res: Response, next: NextFunction) => {
  res.locals.requireAuth()(req, res, next);
}, (req: Request, res: Response) => {
  const user = req.auth0.user!;
  res.json({ user });
});
```

**Key Differences:**
- Full TypeScript types included out of the box
- `req.auth0.user` is properly typed
- Better IDE autocomplete support

## Manual JWKS Configuration

### express-oauth2-jwt-bearer (Before)

```javascript
// Skip discovery and provide JWKS URI directly
app.use(auth({
  jwksUri: 'https://YOUR_DOMAIN/.well-known/jwks.json',
  issuer: 'https://YOUR_DOMAIN/',
  audience: 'https://myapi.com',
}));
```

### @auth0/auth0-express-api (After)

Manual JWKS configuration is not currently supported. The SDK automatically discovers the JWKS endpoint from the domain:

```javascript
// Automatic discovery from domain
const auth0Router = createAuth0ApiRouter({
  domain: 'YOUR_DOMAIN',
  audience: 'https://myapi.com',
});

app.use(auth0Router);
```

## Advanced Token Validation

### express-oauth2-jwt-bearer (Before)

```javascript
app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
  clockTolerance: 10, // seconds
  maxTokenAge: 3600, // seconds
  strict: true,
  allowedSigningAlgs: ['RS256'],
}));
```

### @auth0/auth0-express-api (After)

Advanced validation options are handled automatically:

```javascript
const auth0Router = createAuth0ApiRouter({
  domain: 'YOUR_DOMAIN',
  audience: 'https://myapi.com',
  // Other options are configured with sensible defaults
});

app.use(auth0Router);
```

**Note:** Custom validation options like `clockTolerance`, `maxTokenAge`, and `strict` are not currently configurable in the new SDK. They use secure defaults.

## DPoP Support

### express-oauth2-jwt-bearer (Before)

```javascript
app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://myapi.com',
  dpop: {
    mode: 'required', // or 'optional', 'disabled'
    iatOffset: 0,
    iatLeeway: 60,
  },
}));
```

### @auth0/auth0-express-api (After)

DPoP (Demonstration of Proof-of-Possession) is not currently supported in `@auth0/auth0-express-api`.

## Summary of Breaking Changes

1. **Package name** - `express-oauth2-jwt-bearer` → `@auth0/auth0-express-api`
2. **Import** - `auth` function → `createAuth0ApiRouter` function
3. **Configuration**:
   - `issuerBaseURL` → `domain` (remove https:// prefix)
   - No `authRequired` option (routes are public by default)
   - No `jwksUri` / `issuer` options (auto-discovered)
4. **Request object** - `req.auth` → `req.auth0.user`
5. **Authentication approach**:
   - Old: Global authentication by default
   - New: Per-route authentication with `res.locals.requireAuth()`
6. **Middleware functions** - No built-in `requiredScopes()`, `claimEquals()`, `claimIncludes()`, `claimCheck()` - create custom middleware
7. **Scope validation** - Only "require all" is built-in, "any scope" needs custom middleware
8. **Token access** - No direct access to raw token or JWT header

## Not Migrated (Features Not Available)

The following features from `express-oauth2-jwt-bearer` are not currently available in `@auth0/auth0-express-api`:

1. **DPoP Authentication** - Not supported
2. **Manual JWKS/Issuer Configuration** - Automatic discovery only
3. **Custom Validation Options** - `clockTolerance`, `maxTokenAge`, `strict`, `allowedSigningAlgs` use defaults
4. **scopeIncludesAny** - Requires custom middleware
5. **Claim validation helpers** - `claimEquals`, `claimIncludes`, `claimCheck` require custom implementation

## Getting Help

- [Auth0 Community](https://community.auth0.com)
- [GitHub Issues](https://github.com/auth0/auth0-express/issues)
- [Documentation](https://github.com/auth0/auth0-express)

## Next Steps

After migrating your basic configuration:

1. Test authentication with valid and invalid tokens
2. Verify scope protection works correctly
3. Test custom claim validation if you implemented it
4. Update your tests to work with the new API
5. Gradually migrate advanced features

Remember to thoroughly test your API authentication in a development environment before deploying to production.
