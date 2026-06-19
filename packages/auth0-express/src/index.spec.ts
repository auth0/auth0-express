import { expect, test, afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { generateToken } from './test-utils/tokens.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createAuth0 } from './index.js';
import { decrypt, encrypt } from './test-utils/encryption.js';
import { claimCheck } from './middleware/claim-check.js';
import { claimEquals } from './middleware/claim-equals.js';
import { claimIncludes } from './middleware/claim-includes.js';
import { requiresAuth } from './middleware/require-auth.js';

const domain = 'auth0.local';
const mcdDomain = 'tenant-b.custom-domain.com';
let accessToken: string;
let idToken: string;
let mockOpenIdConfiguration = {
  issuer: `https://${domain}/`,
  authorization_endpoint: `https://${domain}/authorize`,
  backchannel_authentication_endpoint: `https://${domain}/custom-authorize`,
  token_endpoint: `https://${domain}/custom/token`,
  end_session_endpoint: `https://${domain}/logout`,
};

const restHandlers = [
  http.get(`https://${domain}/.well-known/openid-configuration`, () => {
    return HttpResponse.json(mockOpenIdConfiguration);
  }),
  http.post(mockOpenIdConfiguration.backchannel_authentication_endpoint, () => {
    return HttpResponse.json({
      auth_req_id: 'auth_req_123',
      expires_in: 60,
    });
  }),

  http.post(mockOpenIdConfiguration.token_endpoint, async () => {
    return HttpResponse.json({
      access_token: accessToken,
      id_token: idToken,
      expires_in: 60,
      token_type: 'Bearer',
    });
  }),
];

const server = setupServer(...restHandlers);

// Start server before all tests
beforeAll(() =>
  server.listen({
    onUnhandledRequest: 'bypass',
  })
);

// Close server after all tests
afterAll(() => server.close());

beforeEach(async () => {
  accessToken = await generateToken(domain, 'user_123');
  idToken = await generateToken(domain, 'user_123', '<client_id>');
  server.use(
    http.get(`https://${mcdDomain}/.well-known/openid-configuration`, () =>
      HttpResponse.json({
        issuer: `https://${mcdDomain}/`,
        authorization_endpoint: `https://${mcdDomain}/authorize`,
        backchannel_authentication_endpoint: `https://${mcdDomain}/custom-authorize`,
        token_endpoint: `https://${mcdDomain}/custom/token`,
        end_session_endpoint: `https://${mcdDomain}/logout`,
      })
    )
  );
});

afterEach(() => {
  mockOpenIdConfiguration = {
    issuer: `https://${domain}/`,
    authorization_endpoint: `https://${domain}/authorize`,
    backchannel_authentication_endpoint: `https://${domain}/custom-authorize`,
    token_endpoint: `https://${domain}/custom/token`,
    end_session_endpoint: `https://${domain}/logout`,
  };
  server.resetHandlers();
});

// Helper function to parse Set-Cookie header
function parseCookies(setCookieHeader: string | string[] | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!setCookieHeader) return cookies;

  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  headers.forEach((header) => {
    const parts = header.split(';')[0]!.split('=');
    if (parts.length >= 2) {
      const name = parts[0]!.trim();
      const value = parts.slice(1).join('=').trim();
      cookies[name] = value;
    }
  });
  return cookies;
}

// Helper function to create a configured Express app
function createConfiguredApp(
  options: Parameters<typeof createAuth0>[0],
  appOptions: { trustProxy?: boolean } = {}
) {
  const app = express();
  if (appOptions.trustProxy) {
    app.set('trust proxy', true);
  }
  app.use(cookieParser());
  app.use(express.json());
  app.use(createAuth0(options));
  return app;
}

test('auth/login redirects to authorize', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  const res = await request(app).get('/auth/login');
  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.host).toBe(domain);
  expect(url.pathname).toBe('/authorize');
  expect(url.searchParams.get('client_id')).toBe('<client_id>');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback');
  expect(url.searchParams.get('scope')).toBe('openid profile email offline_access');
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('code_challenge')).toBeTypeOf('string');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.size).toBe(6);
});

test('auth/login redirects to authorize when not using a root appBaseUrl', async () => {
  const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000/subpath',
      sessionSecret: '<secret>',
  });

  const res = await request(app).get('/auth/login');
  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.host).toBe(domain);
  expect(url.pathname).toBe('/authorize');
  expect(url.searchParams.get('client_id')).toBe('<client_id>');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/subpath/auth/callback');
  expect(url.searchParams.get('scope')).toBe('openid profile email offline_access');
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('code_challenge')).toBeTypeOf('string');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.size).toBe(6);
});

test('auth/login should put the appState in the transaction store', async () => {
  const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
  });

  const res = await request(app)
    .get('/auth/login')
    .query({ returnTo: 'http://localhost:3000/custom-return' });
  const cookieName = '__a0_tx';
  const cookies = parseCookies(res.headers['set-cookie']);
  const cookieValueRaw = cookies[cookieName]!;
  const cookieValue = (await decrypt(cookieValueRaw, '<secret>', '__a0_tx')) as { appState: { returnTo: string } };

  expect(cookieValue?.appState?.returnTo).toBe('http://localhost:3000/custom-return');
});

test('auth/login uses custom route when provided', async () => {
  const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
      routes: {
        login: '/custom-auth/login',
        callback: '/custom-auth/callback',
      },
  });

  const res = await request(app).get('/custom-auth/login');
  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.host).toBe(domain);
  expect(url.pathname).toBe('/authorize');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/custom-auth/callback');
});

test('auth/login uses the domain resolver to pick the authorize host', async () => {
  const app = createConfiguredApp({
    domain: async () => mcdDomain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  const res = await request(app).get('/auth/login');
  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.host).toBe(mcdDomain);
  expect(url.pathname).toBe('/authorize');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback');
});

test('domain resolver receives the Express request context', async () => {
  let seenHost: string | undefined;
  const app = createConfiguredApp({
    domain: (storeOptions) => {
      seenHost = storeOptions?.request?.headers['x-tenant'] as string | undefined;
      return mcdDomain;
    },
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  const res = await request(app).get('/auth/login').set('x-tenant', 'tenant-b');

  expect(res.status).toBe(302);
  expect(seenHost).toBe('tenant-b');
});

test('auth/login with a resolver infers appBaseUrl when omitted', async () => {
  const app = createConfiguredApp(
    {
      domain: async () => mcdDomain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: undefined,
      sessionSecret: '<secret>',
    },
    { trustProxy: true }
  );

  const res = await request(app)
    .get('/auth/login')
    .set('host', 'app.example.com')
    .set('x-forwarded-proto', 'https')
    .set('x-forwarded-host', 'app.example.com');
  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.host).toBe(mcdDomain);
  expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/auth/callback');
});

test('auth/callback redirects to /', async () => {
  const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
  });

  const cookieName = '__a0_tx';
  const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);
  const res = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${cookieValue}`);
  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.host).toBe('localhost:3000');
  expect(url.pathname).toBe('/');
  expect(url.searchParams.size).toBe(0);
});

test('auth/callback redirects to / when not using a root appBaseUrl', async () => {
  const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000/subpath',
      sessionSecret: '<secret>',
  });

  const cookieName = '__a0_tx';
  const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);
  const res = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${cookieValue}`);
  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.host).toBe('localhost:3000');
  expect(url.pathname).toBe('/subpath');
  expect(url.searchParams.size).toBe(0);
});

test('auth/callback redirects to returnTo in state', async () => {
  const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
  });

  const cookieName = '__a0_tx';
  const cookieValue = await encrypt(
    { appState: { returnTo: 'http://localhost:3000/custom-return' } },
    '<secret>',
    cookieName,
    Date.now() + 1000
  );
  const res = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${cookieValue}`);

  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.host).toBe('localhost:3000');
  expect(url.pathname).toBe('/custom-return');
  expect(url.searchParams.size).toBe(0);
});

test('auth/callback uses custom route when provided', async () => {
  const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
      routes: {
        callback: '/custom-auth/callback',
      },
  });

  const cookieName = '__a0_tx';
  const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);
  const res = await request(app)
    .get('/custom-auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${cookieValue}`);
  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.host).toBe('localhost:3000');
  expect(url.pathname).toBe('/');
  expect(url.searchParams.size).toBe(0);
});

test('auth/logout redirects to logout', async () => {
  const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
  });

  const res = await request(app).get('/auth/logout');
  const url = new URL(res.headers['location']?.toString() || '');

  expect(res.status).toBe(302);
  expect(url.host).toBe(domain);
  expect(url.pathname).toBe('/logout');
  expect(url.searchParams.get('client_id')).toBe('<client_id>');
  expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:3000');
  expect(url.searchParams.size).toBe(2);
});

test('auth/logout uses custom route when provided', async () => {
  const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
      routes: {
        logout: '/custom-auth/logout',
      },
  });

  const res = await request(app).get('/custom-auth/logout');
  const url = new URL(res.headers['location']?.toString() || '');

  expect(res.status).toBe(302);
  expect(url.host).toBe(domain);
  expect(url.pathname).toBe('/logout');
});

test('auth/logout uses the inferred base URL for post_logout_redirect_uri', async () => {
  const app = createConfiguredApp(
    {
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      appBaseUrl: undefined,
    },
    { trustProxy: true }
  );

  const res = await request(app)
    .get('/auth/logout')
    .set('host', 'preview.example.com')
    .set('x-forwarded-proto', 'https');

  const url = new URL(res.headers['location']?.toString() || '');

  expect(res.status).toBe(302);
  expect(url.pathname).toBe('/logout');
  expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://preview.example.com');
});

test('auth/login supports additional authorization parameters', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  const res = await request(app).get('/auth/login').query({
    prompt: 'login',
    screen_hint: 'signup',
    organization: 'org_123',
  });
  const url = new URL(res.headers['location']?.toString() ?? '');

  expect(res.status).toBe(302);
  expect(url.searchParams.get('prompt')).toBe('login');
  expect(url.searchParams.get('screen_hint')).toBe('signup');
  expect(url.searchParams.get('organization')).toBe('org_123');
});

test('auth/login preserves returnTo with prompt=none', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  const res = await request(app).get('/auth/login').query({
    prompt: 'none',
    returnTo: 'http://localhost:3000/profile',
  });
  const cookieName = '__a0_tx';
  const cookies = parseCookies(res.headers['set-cookie']);
  const cookieValueRaw = cookies[cookieName]!;
  const cookieValue = (await decrypt(cookieValueRaw, '<secret>', '__a0_tx')) as { appState: { returnTo: string } };

  expect(res.status).toBe(302);
  expect(cookieValue?.appState?.returnTo).toBe('http://localhost:3000/profile');

  const url = new URL(res.headers['location']?.toString() ?? '');
  expect(url.searchParams.get('prompt')).toBe('none');
});

test('auth/callback handles login_required error from prompt=none', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  const cookieName = '__a0_tx';
  const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);
  const res = await request(app)
    .get('/auth/callback')
    .query({ error: 'login_required', error_description: 'Login required' })
    .set('cookie', `${cookieName}=${cookieValue}`);

  expect(res.status).toBe(500);
  expect(res.body.error).toBe('login_required');
  expect(res.body.message).toBe('Login required');
});

test('getUser and getSession methods are available after authentication', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  // Add a test route that accesses user data
  app.get('/profile', async (req, res) => {
    const user = await req.auth0.client.getUser();
    const session = await req.auth0.client.getSession();
    res.json({ user, session });
  });

  // First, complete the auth flow to establish a session
  const cookieName = '__a0_tx';
  const txCookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);
  const callbackRes = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${txCookieValue}`);

  // Extract the session cookie from the callback response
  const cookies = parseCookies(callbackRes.headers['set-cookie']);
  // Session cookie might be chunked (e.g., __a0_session.0)
  const sessionCookie = cookies['__a0_session'] || cookies['__a0_session.0'];

  expect(sessionCookie).toBeDefined();

  // Now access the profile route with the session cookie
  // Build cookie header with all session chunks
  const sessionCookieHeader = Object.entries(cookies)
    .filter(([name]) => name.startsWith('__a0_session'))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const profileRes = await request(app)
    .get('/profile')
    .set('cookie', sessionCookieHeader);

  expect(profileRes.status).toBe(200);
  expect(profileRes.body.user).toBeDefined();
  expect(profileRes.body.user.sub).toBe('user_123');
  expect(profileRes.body.session).toBeDefined();
  expect(profileRes.body.session.idToken).toBeDefined();
  expect(profileRes.body.session.tokenSets).toBeInstanceOf(Array);
});

test('sessionConfiguration supports rolling, absolute and inactivity duration', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
    sessionConfiguration: {
      rolling: true,
      absoluteDuration: 7 * 24 * 60 * 60, // 7 days
      inactivityDuration: 2 * 24 * 60 * 60, // 2 days
      cookie: {
        name: 'my_custom_session',
        sameSite: 'strict',
        secure: true,
      },
    },
  });

  const cookieName = '__a0_tx';
  const txCookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);
  const callbackRes = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${txCookieValue}`);

  // Check that custom session cookie name is used
  const cookies = parseCookies(callbackRes.headers['set-cookie']);
  const customSessionCookie = cookies['my_custom_session'] || cookies['my_custom_session.0'];

  expect(customSessionCookie).toBeDefined();
  expect(cookies['__a0_session']).toBeUndefined(); // Default name should not be used

  // Check cookie attributes
  const cookieHeaders = callbackRes.headers['set-cookie'] as unknown as string[];
  const sessionCookieHeader = cookieHeaders.find((h) => h.startsWith('my_custom_session'));

  expect(sessionCookieHeader).toContain('Secure');
  expect(sessionCookieHeader).toContain('SameSite=Strict');
});

test('requiresAuth redirects to login when not authenticated', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  app.get('/protected', requiresAuth(), (req, res) => {
    res.send('Protected content');
  });

  const res = await request(app).get('/protected');

  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('/auth/login');
  expect(res.headers.location).toContain('returnTo=%2Fprotected');
});

test('requiresAuth returns 401 for API requests when not authenticated', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  app.get('/api/me', requiresAuth(), (req, res) => {
    res.json({ user: 'test' });
  });

  const res = await request(app)
    .get('/api/me')
    .set('Accept', 'application/json');

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('unauthorized');
  expect(res.body.message).toBe('Authentication required');
});

test('requiresAuth allows authenticated users to access protected routes', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  app.get('/protected', requiresAuth(), async (req, res) => {
    const user = await req.auth0.client.getUser();
    res.json({ user });
  });

  // First authenticate
  const cookieName = '__a0_tx';
  const txCookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);
  const callbackRes = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${txCookieValue}`);

  const cookies = parseCookies(callbackRes.headers['set-cookie']);
  const sessionCookieHeader = Object.entries(cookies)
    .filter(([name]) => name.startsWith('__a0_session'))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  // Access protected route
  const res = await request(app)
    .get('/protected')
    .set('cookie', sessionCookieHeader);

  expect(res.status).toBe(200);
  expect(res.body.user).toBeDefined();
  expect(res.body.user.sub).toBe('user_123');
});

test('claimEquals allows access when claim matches', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  app.get('/admin', claimEquals('role', 'admin'), (req, res) => {
    res.send('Admin page');
  });

  // Setup authenticated session with role claim
  const cookieName = '__a0_tx';
  const txCookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

  // Mock the tokens to include role claim
  const claims = { role: 'admin' };
  accessToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);
  idToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);

  const callbackRes = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${txCookieValue}`);

  const cookies = parseCookies(callbackRes.headers['set-cookie']);
  const sessionCookieHeader = Object.entries(cookies)
    .filter(([name]) => name.startsWith('__a0_session'))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const res = await request(app)
    .get('/admin')
    .set('cookie', sessionCookieHeader);

  expect(res.status).toBe(200);
  expect(res.text).toBe('Admin page');
});

test('claimEquals denies access when claim does not match', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  app.get('/admin', claimEquals('role', 'admin'), (req, res) => {
    res.send('Admin page');
  });

  // Setup authenticated session without admin role
  const cookieName = '__a0_tx';
  const txCookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

  const claims = { role: 'user' };
  accessToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);
  idToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);

  const callbackRes = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${txCookieValue}`);

  const cookies = parseCookies(callbackRes.headers['set-cookie']);
  const sessionCookieHeader = Object.entries(cookies)
    .filter(([name]) => name.startsWith('__a0_session'))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const res = await request(app)
    .get('/admin')
    .set('cookie', sessionCookieHeader);

  expect(res.status).toBe(403);
  expect(res.body.error).toBe('forbidden');
});

test('claimIncludes allows access when claim includes required values', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  app.delete('/users/:id', claimIncludes('permissions', ['delete:users']), (req, res) => {
    res.send('User deleted');
  });

  const cookieName = '__a0_tx';
  const txCookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

  const claims = {
    permissions: ['read:users', 'delete:users', 'update:users'],
  };
  accessToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);
  idToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);

  const callbackRes = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${txCookieValue}`);

  const cookies = parseCookies(callbackRes.headers['set-cookie']);
  const sessionCookieHeader = Object.entries(cookies)
    .filter(([name]) => name.startsWith('__a0_session'))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const res = await request(app)
    .delete('/users/123')
    .set('cookie', sessionCookieHeader);

  expect(res.status).toBe(200);
  expect(res.text).toBe('User deleted');
});

test('claimCheck allows custom validation logic', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  });

  app.get('/premium', claimCheck((req, claims) => {
    return claims.subscription === 'premium';
  }), (req, res) => {
    res.send('Premium content');
  });

  const cookieName = '__a0_tx';
  const txCookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

  const claims = {
    subscription: 'premium',
  };
  accessToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);
  idToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);

  const callbackRes = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${txCookieValue}`);

  const cookies = parseCookies(callbackRes.headers['set-cookie']);
  const sessionCookieHeader = Object.entries(cookies)
    .filter(([name]) => name.startsWith('__a0_session'))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const res = await request(app)
    .get('/premium')
    .set('cookie', sessionCookieHeader);

  expect(res.status).toBe(200);
  expect(res.text).toBe('Premium content');
});





