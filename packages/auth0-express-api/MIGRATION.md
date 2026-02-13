# Migrating from express-oauth2-jwt-bearer to @auth0/auth0-express-api

This guide will help you migrate your Express.js API from `express-oauth2-jwt-bearer` to `@auth0/auth0-express-api`.

## Overview

`@auth0/auth0-express-api` is a modern, redesigned API authentication middleware for Express.js that provides:

- **Simplified architecture** - Cleaner separation of concerns with a router-based approach
- **TypeScript-first** - Built with TypeScript for better type safety
- **Modern async patterns** - Better async/await support
- **Improved developer experience** - More explicit middleware usage
- **Audit trail support** - Built-in request context tracking with AsyncLocalStorage

## Quick Migration Summary

**Migration Time:** 20-40 minutes for basic setup, 1-2 hours for advanced features

### Key Changes at a Glance

| Aspect | express-oauth2-jwt-bearer | @auth0/auth0-express-api |
|--------|---------------------------|--------------------------|
| **Import** | `auth()` | `createAuth0Api()`, `requireAuth()` |
| **Configuration** | `issuerBaseURL`, `audience` | `domain`, `audience` |
| **Token Info** | `req.auth` | `req.auth0.user` |
| **Protection Pattern** | Global | Per-route middleware |
| **Scopes** | `requiredScopes()` | `requireAuth({ scopes })` |
| **Default Behavior** | Global auth required | All routes public |

### Migration Checklist

- [ ] **Install** new package: `npm install @auth0/auth0-express-api`
- [ ] **Update imports**: `auth()` → `createAuth0Api()`
- [ ] **Rename config** (`issuerBaseURL` → `domain`)
- [ ] **Replace middleware** (factory pattern instead of global)
- [ ] **Update token access** (`req.auth` → `req.auth0.user`)
- [ ] **Update scope validation** (factory pattern)
- [ ] **Update error handling** (RFC 6750 format)
- [ ] **Update tests** (mock factory function)

### Breaking Changes

1. **Per-route middleware** - `requireAuth()` imported and used per-route instead of global middleware
2. **All routes public by default** - Must explicitly protect each route with `requireAuth()`
3. **Token info location** - `req.auth0.user` instead of `req.auth`
4. **RFC 6750 errors** - Standard error format required
5. **No global protection** - Per-route protection only

### Top 3 Common Issues

| Issue | Solution |
|-------|----------|
| **"requireAuth is not a function"** | Import and call: `import { requireAuth } from '@auth0/auth0-express-api'` |
| **Routes unprotected** | Add middleware to each protected route: `app.get('/api', requireAuth(), handler)` |
| **Token info undefined** | Use `req.auth0.user` (includes claims) not `req.auth.payload` |

---

## Installation & Basic Setup

```bash
npm uninstall express-oauth2-jwt-bearer
npm install @auth0/auth0-express-api
```

### Configuration (Before → After)

**Before:**
```javascript
app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://your-api-identifier',
}));
```

**After:**
```javascript
app.use(createAuth0Api({
  domain: 'YOUR_DOMAIN', // No https://
  audience: 'https://your-api-identifier',
}));
```

### Configuration Mapping

| Old | New | Notes |
|-----|-----|-------|
| `issuerBaseURL` | `domain` | Remove `https://` |
| `audience` | `audience` | Same |
| — | `tokenSigningAlg` | Optional, defaults to RS256 |

### Environment Variables

```bash
# Before
ISSUER_BASE_URL=https://YOUR_DOMAIN
API_AUDIENCE=https://your-api-identifier

# After
AUTH0_DOMAIN=YOUR_DOMAIN
AUTH0_AUDIENCE=https://your-api-identifier
```

---

## Per-Route Protection Pattern

This is the most important concept to understand. The new SDK uses **per-route middleware** instead of global middleware.

### Before (Global Middleware)

```javascript
// All routes globally protected
app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  audience: 'https://your-api',
  authRequired: true, // Global
}));

app.get('/data', (req, res) => {
  res.json({ data: 'protected' });
});
```

### After (Per-Route Middleware)

```javascript
import { createAuth0Api, requireAuth } from '@auth0/auth0-express-api';

// Routes are public by default
app.use(createAuth0Api({
  domain: 'YOUR_DOMAIN',
  audience: 'https://your-api',
}));

// Explicitly protect routes with requireAuth middleware
app.get('/data', requireAuth(), async (req, res) => {
  res.json({ data: 'protected' });
});
```

### Why Per-Route?

The per-route pattern provides benefits:

1. **Explicit protection** - You see exactly which routes are protected
2. **Flexible scoping** - Different routes can require different scopes
3. **Composable** - Mix and match middleware
4. **Testable** - Easier to mock in tests

### Example: Mixed Public and Protected Routes

```javascript
import { createAuth0Api, requireAuth } from '@auth0/auth0-express-api';

app.use(createAuth0Api({
  domain: 'YOUR_DOMAIN',
  audience: 'https://your-api',
}));

// Public route
app.get('/public', (req, res) => {
  res.json({ data: 'public' });
});

// Protected route
app.get('/protected', requireAuth(), (req, res) => {
  res.json({ data: 'protected' });
});

// Route requiring specific scope
app.get('/admin', requireAuth({ scopes: 'admin' }), (req, res) => {
  res.json({ data: 'admin only' });
});
```

---

## Token Information & Claims

### Before

```javascript
app.get('/me', (req, res) => {
  const claims = req.auth.payload;
  const token = req.auth.token;

  res.json({
    sub: claims.sub,
    email: claims.email,
  });
});
```

### After

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

app.get('/me', requireAuth(), (req, res) => {
  const user = req.auth0.user;

  res.json({
    sub: user.sub,
    email: user.email,
  });
});
```

### Token Structure

The token is a JWT with standard claims:

```javascript
const user = req.auth0.user;

// Standard claims
user.sub;        // User ID
user.aud;        // Audience
user.iat;        // Issued at
user.exp;        // Expiration
user.iss;        // Issuer

// Custom claims
user['https://myapp/roles'];
user['https://myapp/permissions'];
```

---

## Scope Validation

### Before

```javascript
const { requiredScopes } = require('express-oauth2-jwt-bearer');

app.get('/data', requiredScopes('read:data'), (req, res) => {
  res.json({ data: 'sensitive' });
});

// Multiple scopes (requires ALL)
app.get('/admin', requiredScopes('admin', 'write:all'), (req, res) => {
  res.json({ data: 'admin' });
});
```

### After

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

// Single scope
app.get(
  '/data',
  requireAuth({ scopes: 'read:data' }),
  (req, res) => {
    res.json({ data: 'sensitive' });
  }
);

// Multiple scopes (requires ALL by default)
app.get(
  '/admin',
  requireAuth({ scopes: ['admin', 'write:all'] }),
  (req, res) => {
    res.json({ data: 'admin' });
  }
);
```

### Extracting Scopes from Token

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

app.get('/scopes', requireAuth(), (req, res) => {
  const scopes = req.auth0.user.scope; // Space-separated string
  const scopeArray = scopes.split(' ');

  res.json({ scopes: scopeArray });
});
```

---

## Claim Validation

Validate custom claims in tokens:

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

function requireClaim(claimName, expectedValue) {
  return (req, res, next) => {
    const user = req.auth0.user;

    if (!user || user[claimName] !== expectedValue) {
      return res.status(403).json({
        error: 'insufficient_scope',
        error_description: `Missing required claim: ${claimName}`,
      });
    }

    next();
  };
}

// Usage
app.get(
  '/admin',
  requireAuth(),
  requireClaim('https://myapp/role', 'admin'),
  (req, res) => {
    res.json({ data: 'admin' });
  }
);
```

---

## Error Handling

### RFC 6750 Standard Format

```javascript
// Global error handler
app.use((err, req, res, next) => {
  console.error('Auth error:', err);

  // RFC 6750 error format
  if (err.status === 401) {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Access token is invalid or expired',
    });
  }

  if (err.status === 403) {
    return res.status(403).json({
      error: 'insufficient_scope',
      error_description: 'The request requires higher privileges than provided',
    });
  }

  res.status(err.status || 500).json({
    error: 'invalid_request',
    error_description: process.env.NODE_ENV === 'production'
      ? 'An error occurred'
      : err.message,
  });
});
```

### RFC 6750 Error Codes

| Code | HTTP | Meaning | Example |
|------|------|---------|---------|
| `invalid_token` | 401 | Token is invalid or expired | Tampered token |
| `insufficient_scope` | 403 | Token lacks required scopes | Missing `admin` scope |
| `invalid_request` | 400 | Request malformed | No Authorization header |

### Per-Route Error Handling

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

app.get('/protected', requireAuth(), (req, res, next) => {
  try {
    const user = req.auth0.user;

    if (!user) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token not provided',
      });
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});
```

---

## Testing

Mock the `requireAuth` middleware:

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

// Mock requireAuth for testing
jest.mock('@auth0/auth0-express-api', () => ({
  createAuth0Api: jest.fn(() => (req, res, next) => {
    req.auth0.client = {}; // Mock API client
    next();
  }),
  requireAuth: jest.fn((options = {}) => {
    return (req, res, next) => {
      // Mock authenticated user
      req.auth0 = {
        user: {
          sub: 'user123',
          aud: 'https://your-api',
          scope: 'read:data write:data',
          'https://myapp/role': 'user',
        },
      };
      next();
    };
  }),
}));

// Test protected route
it('returns data when authenticated', async () => {
  const response = await request(app)
    .get('/protected')
    .set('Authorization', `Bearer ${mockToken}`);

  expect(response.status).toBe(200);
});

// Test 401 when not authenticated
it('returns 401 when no token', async () => {
  const response = await request(app).get('/protected');

  expect(response.status).toBe(401);
  expect(response.body.error).toBe('invalid_token');
});
```

**Test Helper:**
```javascript
export function createMockAuth(overrides = {}) {
  return {
    sub: 'user123',
    aud: 'https://your-api',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: 'read:data',
    ...overrides,
  };
}
```

<details>
<summary><strong>Advanced Testing Topics</strong></summary>

### Creating Test JWTs

```javascript
const jwt = require('jsonwebtoken');

function createTestJWT(claims, secret = 'test-secret') {
  return jwt.sign(claims, secret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

// Use in tests
const token = createTestJWT({
  sub: 'user123',
  aud: 'https://your-api',
  scope: 'read:data',
});

const response = await request(app)
  .get('/protected')
  .set('Authorization', `Bearer ${token}`);
```

### Testing Scope Requirements

```javascript
it('returns 403 when scope is missing', async () => {
  const token = createTestJWT({
    sub: 'user123',
    scope: 'read:data', // Missing 'admin' scope
  });

  const response = await request(app)
    .get('/admin')
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(403);
  expect(response.body.error).toBe('insufficient_scope');
});
```

### TypeScript Testing

```typescript
interface MockUser {
  sub: string;
  aud: string;
  scope: string;
  [key: string]: any;
}

function createMockAuth(overrides: Partial<MockUser> = {}): MockUser {
  return {
    sub: 'user123',
    aud: 'https://your-api',
    scope: 'read:data',
    ...overrides,
  };
}
```

</details>

---

## Common Patterns

### Pattern 1: Create Reusable Middleware

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

const requireAuthMiddleware = requireAuth();

app.get('/api/users', requireAuthMiddleware, (req, res) => {
  res.json({ users: [] });
});

app.get('/api/posts', requireAuthMiddleware, (req, res) => {
  res.json({ posts: [] });
});
```

### Pattern 2: Scope-Specific Routes

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

const readRoute = requireAuth({ scopes: 'read:data' });
const writeRoute = requireAuth({ scopes: 'write:data' });
const adminRoute = requireAuth({ scopes: 'admin' });

app.get('/api/data', readRoute, (req, res) => {
  res.json({ data: [] });
});

app.post('/api/data', writeRoute, (req, res) => {
  res.json({ created: true });
});

app.delete('/api/data/:id', adminRoute, (req, res) => {
  res.json({ deleted: true });
});
```

### Pattern 3: Router-Level Protection

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

const router = express.Router();

// Protect entire router
router.use(requireAuth({ scopes: 'admin' }));

router.get('/users', (req, res) => {
  res.json({ users: [] });
});

router.post('/users', (req, res) => {
  res.json({ created: true });
});

app.use('/admin', router);
```

---

## Optional Authentication (Public Routes with Optional Auth)

Allow routes to work with or without authentication:

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

// Public route - works without token
app.get('/public', (req, res) => {
  res.json({ data: 'public' });
});

// Optional auth - works with or without token
app.get('/optional', (req, res) => {
  const user = req.auth0?.user;

  if (user) {
    res.json({ data: 'personalized', user });
  } else {
    res.json({ data: 'generic' });
  }
});

// Protected route - requires token
app.get('/protected', requireAuth(), (req, res) => {
  res.json({ data: req.auth0.user });
});
```

---

## Multiple Audiences Support

Route requests to different APIs based on audience:

```javascript
import { createAuth0Api, requireAuth } from '@auth0/auth0-express-api';

app.use(createAuth0Api({
  domain: 'YOUR_DOMAIN',
  audience: 'https://api-1', // Single audience
}));

app.get('/api1-data', requireAuth(), (req, res) => {
  const user = req.auth0.user;

  if (user.aud === 'https://api-1') {
    res.json({ data: 'api-1 data' });
  } else {
    res.status(403).json({ error: 'wrong audience' });
  }
});
```

---

## CORS Setup

```javascript
const cors = require('cors');

// Allow preflight for API calls
app.use(cors({
  origin: ['http://localhost:3000', 'https://app.example.com'],
  credentials: true,
}));

// Options handler for preflight
app.options('*', cors());

app.use(createAuth0Api({
  domain: 'YOUR_DOMAIN',
  audience: 'https://your-api',
}));

app.get('/data', requireAuth(), (req, res) => {
  res.json({ data: 'protected' });
});
```

<details>
<summary><strong>Handling Preflight Errors</strong></summary>

If preflight requests fail, ensure:

1. CORS middleware is registered before auth middleware
2. OPTIONS method is allowed for all routes
3. Required headers are allowed

```javascript
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
```

</details>

---

## Troubleshooting

### "requireAuth is not a function"

**Problem:** Not importing `requireAuth` from the package.

**Solution:**
```javascript
// Wrong - not importing requireAuth
app.get('/api', requireAuth(), handler);

// Correct - import requireAuth
import { requireAuth } from '@auth0/auth0-express-api';
app.get('/api', requireAuth(), handler);

// Also correct - with options
app.get('/api', requireAuth({ scopes: ['read'] }), handler);
```

### Route not protected - user is undefined

**Problem:** Route is public but should be protected.

**Solution:** Make sure to add `requireAuth()` middleware to each protected route:

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

// Wrong - route not protected
app.get('/api', (req, res) => {
  const user = req.auth0.user; // undefined!
});

// Correct - route protected
app.get('/api', requireAuth(), (req, res) => {
  const user = req.auth0.user; // Defined
});
```

### 401 Unauthorized with valid token

**Problem:** Valid token but still getting 401.

**Solution:**
1. Check token expiration: `user.exp > Date.now() / 1000`
2. Verify audience matches: `user.aud === 'https://your-api'`
3. Check issuer: `user.iss === 'https://YOUR_DOMAIN/'`

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

app.get('/debug', requireAuth(), (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  res.json({
    token: req.auth0.user,
    expires_in: req.auth0.user.exp - now,
    is_expired: req.auth0.user.exp < now,
  });
});
```

### 403 Forbidden - insufficient_scope

**Problem:** Token is valid but doesn't have required scopes.

**Solution:**
1. Check token scopes: `user.scope.split(' ')`
2. Verify scopes match route requirements
3. Request new token with required scopes

```javascript
import { requireAuth } from '@auth0/auth0-express-api';

app.get('/scopes', requireAuth(), (req, res) => {
  const scopes = req.auth0.user.scope.split(' ');
  res.json({ scopes });
});
```

### Cannot access custom claims

**Problem:** Custom claims are undefined.

**Solution:** Custom claims use the format `https://yourapp/claim`:

```javascript
// Wrong - missing namespace
const role = req.auth0.user.role; // undefined

// Correct - with namespace
const role = req.auth0.user['https://myapp/role']; // Defined
```

<details>
<summary><strong>Top 5 Issues (Quickfix)</strong></summary>

1. **"requireAuth is not a function"** → Import: `import { requireAuth } from '@auth0/auth0-express-api'`
2. **Routes unprotected** → Add middleware: `requireAuth()` on each route
3. **Token info undefined** → Use `req.auth0.user` not `req.auth.payload`
4. **CORS preflight fails** → Register cors middleware BEFORE auth router
5. **Custom claims undefined** → Use full namespace: `user['https://myapp/role']`

</details>

---

## Advanced Features

<details>
<summary><strong>Advanced Scope Patterns</strong></summary>

### Hierarchical Scopes

```javascript
// Organize scopes hierarchically
const scopes = {
  read: 'read:data',
  write: 'write:data',
  admin: 'admin:all',
};

// Route requiring write implies read
function hasWriteAccess(req, res, next) {
  const userScopes = req.auth0.user.scope.split(' ');
  if (userScopes.includes(scopes.write)) {
    next();
  } else {
    res.status(403).json({
      error: 'insufficient_scope',
      error_description: 'This operation requires write access',
    });
  }
}
```

### Resource-Specific Scopes

```javascript
// Scopes tied to specific resources
app.get('/api/documents/:id', requireAuth(), (req, res) => {
  const docId = req.params.id;
  const required = `read:document:${docId}`;

  if (req.auth0.user.scope.split(' ').includes(required)) {
    res.json({ document: 'data' });
  } else {
    res.status(403).json({ error: 'insufficient_scope' });
  }
});
```

</details>

<details>
<summary><strong>DPoP Support</strong></summary>

Demonstration of Proof-of-Possession (DPoP) adds extra security:

```javascript
app.use(createAuth0Api({
  domain: 'YOUR_DOMAIN',
  audience: 'https://your-api',
  supportDPoP: true, // Enable DPoP
}));
```

Clients must provide DPoP proof with each request.

</details>

---

## Summary of Breaking Changes

| Feature | Before | After | Migration |
|---------|--------|-------|-----------|
| **Protection** | Global | Per-route | Import and use `requireAuth()` middleware |
| **Token info** | `req.auth.payload` | `req.auth0.user` | Change property |
| **Scopes** | `requiredScopes()` middleware | `requireAuth({ scopes })` option | Pass scopes to `requireAuth()` |
| **Default behavior** | Protected globally | Public by default | Add `requireAuth()` to protect |
| **Error format** | Custom | RFC 6750 standard | Update error responses |

---

## Next Steps

1. **Quick migration** (20 min):
   - [ ] Install package
   - [ ] Update config
   - [ ] Test basic protected route

2. **Complete migration** (1-2 hours):
   - [ ] Protect all routes with factory
   - [ ] Update error handling (RFC 6750)
   - [ ] Update tests
   - [ ] Add scope validation

3. **Deploy**:
   - [ ] Staging environment
   - [ ] Production

---

## Getting Help

- **Documentation:** [Auth0 Express API SDK docs](https://github.com/auth0/auth0-express)
- **Issues:** [GitHub Issues](https://github.com/auth0/auth0-express/issues)
- **Community:** [Auth0 Community](https://community.auth0.com)
