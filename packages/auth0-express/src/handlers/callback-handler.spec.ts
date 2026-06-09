import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import { encrypt } from '../test-utils/encryption.js';
import {
  domain,
  server,
  setupTests,
  resetMockConfig,
  mockOpenIdConfiguration,
  createConfiguredApp,
} from '../test-utils/test-setup.js';

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
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      appBaseUrl: undefined,
    });

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
});
