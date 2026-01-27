import { expect, test, afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { generateToken } from './test-utils/tokens.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createAuth0Router } from './index.js';
import { decrypt, encrypt } from './test-utils/encryption.js';

const domain = 'auth0.local';
let accessToken: string;
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
      id_token: await generateToken(domain, 'user_123', '<client_id>'),
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
function createConfiguredApp(options: Parameters<typeof createAuth0Router>[0]) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(createAuth0Router(options));
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

