import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import {
  domain,
  server,
  setupTests,
  resetMockConfig,
  createConfiguredApp,
  parseCookies,
} from '../test-utils/test-setup.js';
import { decrypt } from '../test-utils/encryption.js';

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

describe('login handler', () => {
  test('handles unsafe returnTo by sanitizing it in transaction state', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    // Try to redirect to external site
    const res = await request(app).get('/auth/login').query({ returnTo: 'http://evil.com/phishing' });

    expect(res.status).toBe(302);
    const url = new URL(res.headers['location']?.toString() ?? '');

    // Should be redirected to authorize endpoint
    expect(url.host).toBe(domain);
    expect(url.pathname).toBe('/authorize');

    // Verify that the transaction cookie contains the sanitized returnTo value
    const cookies = parseCookies(res.headers['set-cookie']);
    const txCookie = cookies['__a0_tx'];
    expect(txCookie).toBeDefined();

    // Decrypt the transaction cookie to inspect its contents
    const txState = await decrypt<{ appState?: { returnTo?: string } }>(
      txCookie!,
      '<secret>',
      '__a0_tx'
    );

    // The returnTo in the transaction state should be undefined for unsafe URLs
    expect(txState.appState?.returnTo).toBeUndefined();
  });

  test('handles safe returnTo by storing it in transaction state', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    // Safe same-origin redirect
    const res = await request(app).get('/auth/login').query({ returnTo: '/dashboard' });

    expect(res.status).toBe(302);
    const url = new URL(res.headers['location']?.toString() ?? '');

    // Should be redirected to authorize endpoint
    expect(url.host).toBe(domain);
    expect(url.pathname).toBe('/authorize');

    // Verify that the transaction cookie contains the safe returnTo value
    const cookies = parseCookies(res.headers['set-cookie']);
    const txCookie = cookies['__a0_tx'];
    expect(txCookie).toBeDefined();

    // Decrypt the transaction cookie to inspect its contents
    const txState = await decrypt<{ appState?: { returnTo?: string } }>(
      txCookie!,
      '<secret>',
      '__a0_tx'
    );

    // The returnTo in the transaction state should contain the full safe URL
    expect(txState.appState?.returnTo).toBe('http://localhost:3000/dashboard');
  });

  test('handles errors in startInteractiveLogin', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    // Mock the server to return an error for the authorize endpoint
    server.use(
      http.get(`https://${domain}/.well-known/openid-configuration`, () => {
        return HttpResponse.json({ error: 'server_error' }, { status: 500 });
      })
    );

    const res = await request(app).get('/auth/login');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toBe('unexpected HTTP response status code');
  });

  test('passes through additional authorization parameters', async () => {
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

    expect(res.status).toBe(302);
    const url = new URL(res.headers['location']?.toString() ?? '');

    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('screen_hint')).toBe('signup');
    expect(url.searchParams.get('organization')).toBe('org_123');
  });
});

describe('login handler - query parameter sanitization', () => {
  const appConfig = {
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    appBaseUrl: 'http://localhost:3000',
    sessionSecret: '<secret>',
  };

  describe('OAuth protocol parameter blocklist', () => {
    // These params are completely absent from the authorization URL because the SDK does not include them
    test.each(['state', 'nonce'])('strips %s from the authorization URL', async (param) => {
      const app = createConfiguredApp(appConfig);

      const res = await request(app).get('/auth/login').query({ [param]: 'evil' });

      expect(res.status).toBe(302);
      const url = new URL(res.headers['location']?.toString() ?? '');
      expect(url.searchParams.has(param)).toBe(false);
    });

    // These params are always present in the authorization URL (added by the SDK), but user-supplied values must not override them
    test.each(['response_type', 'code_challenge', 'code_challenge_method', 'client_id', 'redirect_uri'])(
      'does not allow user-supplied value for %s to appear in the authorization URL',
      async (param) => {
        const app = createConfiguredApp(appConfig);

        const res = await request(app).get('/auth/login').query({ [param]: 'evil' });

        expect(res.status).toBe(302);
        const url = new URL(res.headers['location']?.toString() ?? '');
        expect(url.searchParams.get(param)).not.toBe('evil');
      }
    );
  });

  describe('safe parameters still pass through', () => {
    test('allows safe params when mixed with dangerous ones', async () => {
      const app = createConfiguredApp(appConfig);

      const res = await request(app).get('/auth/login').query({
        prompt: 'login',
        screen_hint: 'signup',
        organization: 'org_123',
        login_hint: 'user@example.com',
        ['__proto__']: 'evil',
        state: 'injected',
      });

      expect(res.status).toBe(302);
      const url = new URL(res.headers['location']?.toString() ?? '');

      expect(url.searchParams.get('prompt')).toBe('login');
      expect(url.searchParams.get('screen_hint')).toBe('signup');
      expect(url.searchParams.get('organization')).toBe('org_123');
      expect(url.searchParams.get('login_hint')).toBe('user@example.com');

      expect(url.searchParams.has('__proto__')).toBe(false);
      expect(url.searchParams.has('state')).toBe(false);
    });
  });
});
