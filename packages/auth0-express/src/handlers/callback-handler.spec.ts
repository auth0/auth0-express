import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { encrypt } from '../test-utils/encryption.js';
import {
  domain,
  server,
  setupTests,
  resetMockConfig,
  mockOpenIdConfiguration,
  createConfiguredApp,
  parseCookies,
} from '../test-utils/test-setup.js';
import { createAuth0 } from '../index.js';

beforeAll(() =>
  server.listen({
    onUnhandledRequest: 'bypass',
  })
);

afterAll(() => server.close());

beforeEach(async () => {
  await setupTests();
});

afterEach(() => {
  resetMockConfig();
  server.resetHandlers();
});

describe('callback handler', () => {
  test('handles callback with missing transaction', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    // Call callback without transaction cookie
    const res = await request(app).get('/auth/callback').query({ code: '123' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toBeDefined();
  });

  test('handles login_required error with 500 status', async () => {
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

  test('handles consent_required error with 500 status', async () => {
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
      .query({ error: 'consent_required', error_description: 'Consent required' })
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('consent_required');
    expect(res.body.message).toBe('Consent required');
  });

  test('handles interaction_required error with 500 status', async () => {
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
      .query({ error: 'interaction_required', error_description: 'Interaction required' })
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('interaction_required');
    expect(res.body.message).toBe('Interaction required');
  });

  test('handles other errors with 500 status', async () => {
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
      .query({ error: 'server_error', error_description: 'Something went wrong' })
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server_error');
    expect(res.body.message).toBe('Something went wrong');
  });

  test('returns error name when cause.error is not available', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    // Mock token endpoint to throw an error without cause
    server.use(
      http.post(mockOpenIdConfiguration.token_endpoint, () => {
        return HttpResponse.json({ error: 'invalid_grant' }, { status: 400 });
      })
    );

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

    const res = await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toBeDefined();
  });

  test('redirects to returnTo from appState after successful login', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt(
      { appState: { returnTo: 'http://localhost:3000/dashboard' } },
      '<secret>',
      cookieName,
      Date.now() + 1000
    );

    const res = await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/dashboard');
  });

  test('redirects to appBaseUrl when no returnTo in appState', async () => {
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

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000');
  });

  test('redirects to the inferred base URL when appBaseUrl is omitted', async () => {
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

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

    const res = await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('host', 'preview.example.com')
      .set('x-forwarded-proto', 'https')
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://preview.example.com');
  });

  test('returns 500 when the request host is not in the allow-list', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      appBaseUrl: ['https://app1.example.com'],
    });

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

    const res = await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('host', 'evil.example.com')
      .set('x-forwarded-proto', 'https')
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('InvalidConfigurationError');
  });

  test('redirects to appState.returnTo from a different allowed origin (no re-validation at callback time)', async () => {
    // Login happened on app1, returnTo was stored for app1/dashboard.
    // The callback arrives on app2 (also in the allow-list).
    // Documents that returnTo is not re-validated against the callback-time
    // base URL — the stored returnTo (app1) is used as-is.
    const app = createConfiguredApp(
      {
        domain: domain,
        clientId: '<client_id>',
        clientSecret: '<client_secret>',
        sessionSecret: '<secret>',
        appBaseUrl: ['https://app1.example.com', 'https://app2.example.com'],
      },
      { trustProxy: true }
    );

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt(
      { appState: { returnTo: 'https://app1.example.com/dashboard' } },
      '<secret>',
      cookieName,
      Date.now() + 1000
    );

    const res = await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('host', 'app2.example.com')
      .set('x-forwarded-proto', 'https')
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(302);
    // The redirect target is the login-time returnTo, not the callback-time origin.
    expect(res.headers.location).toBe('https://app1.example.com/dashboard');
  });

  test('falls back to callback-time base URL when appState has no returnTo (allow-list mode)', async () => {
    const app = createConfiguredApp(
      {
        domain: domain,
        clientId: '<client_id>',
        clientSecret: '<client_secret>',
        sessionSecret: '<secret>',
        appBaseUrl: ['https://app1.example.com', 'https://app2.example.com'],
      },
      { trustProxy: true }
    );

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

    const res = await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('host', 'app2.example.com')
      .set('x-forwarded-proto', 'https')
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app2.example.com');
  });
});

describe('callback handler - Enterprise Connect mode', () => {
  test('calls onCallback with user, idTokenClaims, and appState; does not set session cookie', async () => {
    const onCallback = vi.fn(async (_req: unknown, res: express.Response) => {
      res.redirect('/dashboard');
    });

    const app = express();
    app.use(cookieParser());
    app.use(
      createAuth0({
        domain,
        clientId: '<client_id>',
        clientSecret: '<client_secret>',
        appBaseUrl: 'http://localhost:3000',
        sessionSecret: '<secret>',
        enterpriseConnect: true,
        onCallback,
      })
    );

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

    const res = await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
    expect(onCallback).toHaveBeenCalledOnce();

    // No Auth0 session cookie should be set
    const cookies = parseCookies(res.headers['set-cookie']);
    const sessionCookies = Object.keys(cookies).filter((name) => name.startsWith('__a0_session'));
    expect(sessionCookies).toHaveLength(0);
  });

  test('passes appState from transaction cookie to onCallback', async () => {
    let capturedResult: Record<string, unknown> | undefined;
    const onCallback = vi.fn(async (_req: unknown, res: express.Response, result: Record<string, unknown>) => {
      capturedResult = result;
      res.redirect('/dashboard');
    });

    const app = express();
    app.use(cookieParser());
    app.use(
      createAuth0({
        domain,
        clientId: '<client_id>',
        clientSecret: '<client_secret>',
        appBaseUrl: 'http://localhost:3000',
        sessionSecret: '<secret>',
        enterpriseConnect: true,
        onCallback,
      })
    );

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt(
      { appState: { returnTo: 'http://localhost:3000/dashboard' } },
      '<secret>',
      cookieName,
      Date.now() + 1000
    );

    await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(capturedResult?.appState).toEqual({ returnTo: 'http://localhost:3000/dashboard' });
  });

  test('returns 500 when completeInteractiveLogin throws in EC mode', async () => {
    server.use(
      http.post(mockOpenIdConfiguration.token_endpoint, () => {
        return HttpResponse.json({ error: 'invalid_grant' }, { status: 400 });
      })
    );

    const app = express();
    app.use(cookieParser());
    app.use(
      createAuth0({
        domain,
        clientId: '<client_id>',
        clientSecret: '<client_secret>',
        appBaseUrl: 'http://localhost:3000',
        sessionSecret: '<secret>',
        enterpriseConnect: true,
        onCallback: vi.fn(async (_req: unknown, res: express.Response) => res.redirect('/dashboard')),
      })
    );

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

    const res = await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
