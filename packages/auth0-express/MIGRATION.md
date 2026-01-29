# Migrating from express-openid-connect to auth0-express

This guide will help you migrate your Express.js application from `express-openid-connect` to `@auth0/auth0-express`.

## Overview

`@auth0/auth0-express` is a modern, redesigned authentication SDK for Express.js applications that provides:

- **Simplified configuration** - Fewer required options with sensible defaults
- **TypeScript-first** - Built with TypeScript for better type safety and IDE support
- **Modular architecture** - Separate packages for web apps (`@auth0/auth0-express`) and APIs (`@auth0/auth0-express-api`)
- **Improved developer experience** - Cleaner APIs and better async/await support
- **Audit trail support** - Built-in AsyncLocalStorage for tracking request context

## Quick Migration Summary

**Migration Time:** 30-60 minutes for basic setup, 2-4 hours for advanced features

### Key Changes at a Glance

| Aspect | express-openid-connect | @auth0/auth0-express |
|--------|------------------------|----------------------|
| **Import** | `auth()` | `createAuth0()` |
| **Configuration** | `issuerBaseURL`, `baseURL`, `clientID`, `secret` | `domain`, `appBaseUrl`, `clientId`, `sessionSecret` |
| **User Access** | `req.oidc.user` | `await req.auth0.client.getUser()` |
| **Async/Await** | Mostly sync | All methods async |
| **Route Protection** | Global `authRequired` | Custom middleware |
| **Token Access** | `req.oidc.accessToken` | `await req.auth0.client.getAccessToken()` |

### Migration Checklist

- [ ] **Install** new package: `npm install @auth0/auth0-express`
- [ ] **Update imports**: `auth()` → `createAuth0()`
- [ ] **Rename config properties** (see table below)
- [ ] **Add clientSecret** (now required)
- [ ] **Add `await`** to user/session/token access
- [ ] **Create route protection middleware** (no global `authRequired`)
- [ ] **Update custom session stores** (add StoreOptions pattern)
- [ ] **Update tests** (mock async methods)

### Breaking Changes

1. **All methods are async** - Must use `await`
2. **No global auth** - Must explicitly protect routes
3. **StoreOptions required** - Custom session stores need `{ request, response }` parameter
4. **clientSecret required** - Previously optional
5. **No built-in route middleware** - `requiresAuth()` must be custom

### Top 3 Common Issues

| Issue | Solution |
|-------|----------|
| **Missing `await`** | `const user = await req.auth0.client.getUser()` |
| **Custom store missing options** | Add `async set(id, data, options) { const { request, response } = options; }` |
| **Routes not protected** | Create middleware: `if (!await req.auth0.client.getSession()) res.redirect('/auth/login')` |

---

## Installation & Basic Setup

```bash
npm uninstall express-openid-connect
npm install @auth0/auth0-express
```

### Configuration (Before → After)

**Before:**
```javascript
app.use(auth({
  issuerBaseURL: 'https://YOUR_DOMAIN',
  baseURL: 'https://YOUR_APPLICATION_ROOT_URL',
  clientID: 'YOUR_CLIENT_ID',
  secret: 'LONG_RANDOM_STRING',
}));
```

**After:**
```javascript
app.use(createAuth0({
  domain: 'YOUR_DOMAIN', // No https://
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET', // Now required
  appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
  sessionSecret: 'LONG_RANDOM_STRING',
}));
```

### Configuration Mapping

| Old | New | Notes |
|-----|-----|-------|
| `issuerBaseURL` | `domain` | Remove `https://` |
| `baseURL` | `appBaseUrl` | Renamed |
| `clientID` | `clientId` | Camel case |
| `secret` | `sessionSecret` | Renamed |
| — | `clientSecret` | Required (was optional) |

### Environment Variables

```bash
# Before
ISSUER_BASE_URL=https://YOUR_DOMAIN
BASE_URL=https://YOUR_APPLICATION_ROOT_URL
CLIENT_ID=YOUR_CLIENT_ID
SECRET=LONG_RANDOM_VALUE

# After
AUTH0_DOMAIN=YOUR_DOMAIN
APP_BASE_URL=https://YOUR_APPLICATION_ROOT_URL
AUTH0_CLIENT_ID=YOUR_CLIENT_ID
AUTH0_CLIENT_SECRET=YOUR_CLIENT_SECRET
AUTH0_SESSION_SECRET=LONG_RANDOM_VALUE
```

---

## Routes

### Default Routes

| Path | Before | After |
|------|--------|-------|
| Login | `/login` | `/auth/login` |
| Logout | `/logout` | `/auth/logout` |
| Callback | `/callback` | `/auth/callback` |
| Backchannel | — | `/auth/backchannel-logout` |

### Custom Routes

```javascript
app.use(createAuth0({
  // ... other config
  routes: {
    login: '/custom/login',
    logout: '/custom/logout',
    callback: '/custom/callback',
  },
  mountRoutes: false, // Disable all routes
}));
```

Note: `postLogoutRedirect` is gone. After logout, users redirect to `appBaseUrl`.

---

## User Access

**Before:**
```javascript
app.get('/profile', (req, res) => {
  if (req.oidc.isAuthenticated()) {
    res.json({ user: req.oidc.user });
  }
});
```

**After:**
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

Key change: Add `await`, `getUser()` returns null when not authenticated.

---

## Route Protection

**All routes are public by default.** Create custom middleware to protect them:

```javascript
// Create a protection middleware
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

No more global `authRequired`. More explicit, more flexible.

---

## Error Handling

```javascript
// Global error handler
app.use((err, req, res, next) => {
  console.error('Auth error:', err);

  if (err.status === 401) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (err.status === 403) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Error' : err.message
  });
});

// Per-route with try-catch
app.get('/protected', async (req, res, next) => {
  try {
    const user = await req.auth0.client.getUser();
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user });
  } catch (error) {
    next(error);
  }
});
```

**Remember:** All methods are async, always use try-catch or pass to error handler.

---

## Testing

The new SDK is async throughout. Mock the client methods:

```javascript
// Mock Auth0 client
app.use((req, res, next) => {
  req.auth0 = {
    client: {
      getUser: jest.fn(),
      getSession: jest.fn(),
      getAccessToken: jest.fn(),
    },
  };
  next();
});

// Test protected route
it('returns user profile when authenticated', async () => {
  const mockUser = { sub: 'user123', name: 'Test User' };

  app.use((req, res, next) => {
    req.auth0.client.getUser.mockResolvedValue(mockUser);
    next();
  });

  const response = await request(app).get('/profile');
  expect(response.status).toBe(200);
  expect(response.body.user.name).toBe('Test User');
});

// Test unauthorized
it('returns 401 when not authenticated', async () => {
  app.use((req, res, next) => {
    req.auth0.client.getUser.mockResolvedValue(null);
    next();
  });

  const response = await request(app).get('/profile');
  expect(response.status).toBe(401);
});
```

**Test Helper:**
```javascript
export function createAuthMock(overrides = {}) {
  return {
    getUser: jest.fn().mockResolvedValue(null),
    getSession: jest.fn().mockResolvedValue(null),
    getAccessToken: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}
```

<details>
<summary><strong>Advanced Testing Topics</strong></summary>

### Testing Custom Session Stores

Custom stores must accept `options` with `{ request, response }`:

```javascript
class CustomStore {
  async set(key, value, options) {
    const { request, response } = options;
    // Save to database
  }
  async delete(key) {
    // Delete from database
  }
}

it('stores and retrieves session data', async () => {
  const store = new CustomStore();
  const sessionData = { user: { sub: 'user123' } };

  await store.set('session-key', sessionData, { request: {}, response: {} });
  const retrieved = await store.get('session-key');

  expect(retrieved).toEqual(sessionData);
});
```

### Integration Testing

```javascript
it('logs in user with real Auth0', async () => {
  const response = await request(app)
    .get('/auth/login')
    .expect(302);

  expect(response.headers.location).toContain('https://YOUR_DOMAIN');
});
```

### TypeScript Testing

```typescript
interface MockAuth0Client {
  getUser: jest.Mock;
  getSession: jest.Mock;
}

function createAuthMock(): MockAuth0Client {
  return {
    getUser: jest.fn(),
    getSession: jest.fn(),
  };
}
```

</details>

---

## Token Access

**Before:**
```javascript
const token = req.oidc.accessToken;
```

**After:**
```javascript
const token = await req.auth0.client.getAccessToken();
```

```javascript
app.get('/api', async (req, res, next) => {
  try {
    const token = await req.auth0.client.getAccessToken();
    if (!token) {
      return res.status(401).json({ error: 'No access token' });
    }

    // Use token to call API
    const response = await fetch('https://api.example.com/data', {
      headers: { Authorization: `Bearer ${token}` },
    });

    res.json(await response.json());
  } catch (error) {
    next(error);
  }
});
```

---

## Session Configuration

### Default Session Store

```javascript
app.use(createAuth0({
  domain: 'YOUR_DOMAIN',
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
  sessionSecret: 'LONG_RANDOM_STRING',
  // Session configuration
  sessionConfig: {
    name: 'appSession',
    absoluteDuration: 604800000, // 7 days
    rolling: true,
    rollingDuration: 86400000, // 1 day
  },
}));
```

### Custom Session Store

Custom stores must implement:

```javascript
class CustomStore {
  async set(key, value, options) {
    const { request, response } = options; // Use if needed
    // Save to database
  }

  async get(key) {
    // Retrieve from database
  }

  async delete(key) {
    // Delete from database (was destroy)
  }
}

app.use(createAuth0({
  sessionStore: new CustomStore(),
  // ... other config
}));
```

Key change: `delete()` replaces `destroy()`, and `set()` receives StoreOptions.

<details>
<summary><strong>StoreOptions Pattern</strong></summary>

The new SDK passes `{ request, response }` to session store methods. Use this when you need request/response context:

```javascript
class DatabaseStore {
  async set(key, value, options) {
    const { request, response } = options;

    // Access request headers, IP, etc.
    const ip = request.ip;
    const userAgent = request.get('user-agent');

    // Store session with context
    await db.sessions.create({
      id: key,
      data: value,
      ip,
      userAgent,
      createdAt: new Date(),
    });
  }

  async get(key) {
    const session = await db.sessions.findById(key);
    return session?.data || null;
  }

  async delete(key) {
    await db.sessions.deleteOne({ id: key });
  }
}
```

</details>

---

## Custom Login Parameters

### Basic Example

```javascript
app.get('/login-with-redirect', (req, res) => {
  res.redirect(
    `/auth/login?returnTo=${encodeURIComponent(req.query.returnTo || '/dashboard')}`
  );
});
```

### Force Re-authentication

```javascript
// Require user to re-authenticate
res.redirect('/auth/login?prompt=login');
```

### Pre-fill Username

```javascript
// Pre-fill login_hint parameter
res.redirect(`/auth/login?login_hint=${encodeURIComponent(email)}`);
```

### Localize UI

```javascript
// Set UI language
res.redirect('/auth/login?ui_locales=es');
```

### Combine Multiple Parameters

```javascript
const params = new URLSearchParams({
  returnTo: encodeURIComponent('/dashboard'),
  prompt: 'login',
  login_hint: 'user@example.com',
  ui_locales: 'es',
});
res.redirect(`/auth/login?${params.toString()}`);
```

<details>
<summary><strong>All Supported Authorization Parameters</strong></summary>

| Parameter | Purpose | Example |
|-----------|---------|---------|
| `returnTo` | Redirect after login | `/dashboard` |
| `prompt` | `login` forces re-auth | `prompt=login` |
| `login_hint` | Pre-fill username | `user@example.com` |
| `ui_locales` | UI language | `es`, `fr` |
| `screen_hint` | Skip login/signup UI | `signup` |
| `max_age` | Max age in seconds | `3600` |

</details>

---

## Custom Logout

```javascript
app.get('/logout', (req, res) => {
  res.redirect('/auth/logout');
});
```

---

## Claim Validation

```javascript
async function requireClaim(claimName, expectedValue) {
  return async (req, res, next) => {
    try {
      const user = await req.auth0.client.getUser();

      if (!user || user[claimName] !== expectedValue) {
        return res.status(403).json({
          error: `Missing required claim: ${claimName}`,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

// Usage
app.get('/admin', requireClaim('role', 'admin'), async (req, res) => {
  res.send('Admin content');
});
```

---

## Backchannel Logout

Backchannel logout allows Auth0 to notify your app when a user logs out from another application.

```javascript
// No configuration needed - automatically available at /auth/backchannel-logout
// The SDK handles the POST request and clears the session
```

---

## Silent Authentication

Silent authentication (checking if user has a session without redirect) is not built-in. Use this workaround:

```javascript
// Check session without redirect
app.get('/api/check-session', async (req, res) => {
  try {
    const session = await req.auth0.client.getSession();
    const user = await req.auth0.client.getUser();

    if (user) {
      res.json({ authenticated: true, user });
    } else {
      res.json({ authenticated: false });
    }
  } catch (error) {
    res.json({ authenticated: false });
  }
});
```

---

## Troubleshooting

### getUser() returns undefined

**Problem:** `getUser()` returns undefined even when user is logged in.

**Solution:** Make sure you're using `await`:
```javascript
const user = await req.auth0.client.getUser(); // Correct
const user = req.auth0.client.getUser(); // Wrong!
```

### Cannot read property 'client' of undefined

**Problem:** `req.auth0` is undefined.

**Solution:** Ensure `createAuth0` middleware is registered before your route handlers:
```javascript
// Correct order
app.use(createAuth0({ ... }));
app.get('/profile', async (req, res) => { ... });

// Wrong order - auth router comes after route definitions
app.get('/profile', async (req, res) => { ... });
app.use(createAuth0({ ... }));
```

### Custom Session Store Errors

**Problem:** "StoreOptions is not defined" or store methods fail.

**Solution:** Ensure your store methods accept the `options` parameter:
```javascript
// Wrong
async set(key, value) { ... }

// Correct
async set(key, value, options) {
  const { request, response } = options;
  // ...
}
```

### Token refresh failed

**Problem:** Access token is expired and cannot be refreshed.

**Solution:**
1. Ensure `clientSecret` is configured correctly
2. Check token expiration and re-authenticate if needed
3. Verify API credentials in Auth0 dashboard

### Infinite redirect loop

**Problem:** Login redirects to login, logout redirects to logout.

**Solution:** Make sure middleware is properly registered and check `returnTo` parameter values.

### Session not persisting

**Problem:** Session is lost after page reload.

**Solution:**
1. Check `sessionSecret` is set and consistent
2. Verify session store is configured correctly
3. Check browser cookies are allowed

### "TypeError: fetch is not defined"

**Problem:** In Node.js < 18, fetch is not available globally.

**Solution:**
```javascript
// Option 1: Use node-fetch
npm install node-fetch

// Option 2: Update to Node.js 18+

// Option 3: Use custom HTTP client
app.use(createAuth0({
  httpClient: customHttpClient,
  // ... other config
}));
```

### CORS errors during authentication

**Problem:** Cross-origin requests fail during callback.

**Solution:**
1. Verify `appBaseUrl` is correct
2. Check Auth0 application allowed callback URLs
3. Ensure `Access-Control-Allow-Credentials: true` header is set

<details>
<summary><strong>Top 5 Issues (Quickfix)</strong></summary>

1. **Missing `await`** → Add `await` before all client method calls
2. **Routes unprotected** → Create `requireSession` middleware
3. **StoreOptions missing** → Add `options` parameter to store methods
4. **req.auth0 undefined** → Move `createAuth0()` before route definitions
5. **Token access fails** → Check `clientSecret` and token expiration

</details>

---

## Advanced Features

<details>
<summary><strong>Client Authentication Methods (private_key_jwt)</strong></summary>

For production, use `private_key_jwt` instead of `client_secret`:

```javascript
app.use(createAuth0({
  domain: 'YOUR_DOMAIN',
  clientId: 'YOUR_CLIENT_ID',
  clientAuthMethod: 'private_key_jwt',
  clientSecret: fs.readFileSync('./private-key.pem', 'utf8'),
  appBaseUrl: 'https://YOUR_APPLICATION_ROOT_URL',
  sessionSecret: 'LONG_RANDOM_STRING',
}));
```

Generate key:
```bash
openssl genrsa -out private-key.pem 2048
```

Upload public key to Auth0 dashboard.

</details>

<details>
<summary><strong>Pushed Authorization Requests (PAR)</strong></summary>

PAR improves security by sending sensitive parameters directly to Auth0 instead of through the URL.

```javascript
app.use(createAuth0({
  // ... config
  pushedAuthorizationRequests: true,
}));
```

Benefits:
- Sensitive data not in URL
- Shorter authorization URLs
- Better security for mobile apps

</details>

<details>
<summary><strong>Custom HTTP Configuration</strong></summary>

Use custom HTTP client or proxy:

```javascript
app.use(createAuth0({
  // ... config
  httpClient: {
    fetch: customFetchFunction,
    timeout: 5000,
  },
}));
```

</details>

---

## Summary of Breaking Changes

| Feature | Before | After | Migration |
|---------|--------|-------|-----------|
| **User access** | Sync | Async | Add `await` |
| **Route protection** | Global | Per-route | Create middleware |
| **Session store** | `destroy()` | `delete()` + options | Update method names |
| **Error handling** | Implicit | Explicit | Add try-catch |
| **Config** | Multiple options | Minimal | Rename properties |

---

## Next Steps

1. **Quick migration** (30 min):
   - [ ] Install package
   - [ ] Update config
   - [ ] Test basic flow

2. **Complete migration** (2-4 hours):
   - [ ] Update all routes
   - [ ] Add error handling
   - [ ] Update tests
   - [ ] Custom session store (if needed)

3. **Deploy**:
   - [ ] Staging environment
   - [ ] Production

---

## Getting Help

- **Documentation:** [Auth0 Express SDK docs](https://github.com/auth0/auth0-express)
- **Issues:** [GitHub Issues](https://github.com/auth0/auth0-express/issues)
- **Community:** [Auth0 Community](https://community.auth0.com)
