import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  domain,
  server,
  setupTests,
  resetMockConfig,
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

describe('logout handler', () => {
  test('uses the static appBaseUrl for post_logout_redirect_uri', async () => {
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
    expect(url.pathname).toBe('/logout');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:3000');
  });

  test('infers the base URL from the request host when appBaseUrl is omitted', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      appBaseUrl: undefined,
    });

    const res = await request(app)
      .get('/auth/logout')
      .set('host', 'preview.example.com')
      .set('x-forwarded-proto', 'https');

    const url = new URL(res.headers['location']?.toString() || '');

    expect(res.status).toBe(302);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://preview.example.com');
  });

  test('uses the matching allow-list entry for post_logout_redirect_uri', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      appBaseUrl: ['https://app1.example.com', 'https://app2.example.com'],
    });

    const res = await request(app)
      .get('/auth/logout')
      .set('host', 'app2.example.com')
      .set('x-forwarded-proto', 'https');

    const url = new URL(res.headers['location']?.toString() || '');

    expect(res.status).toBe(302);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://app2.example.com');
  });

  test('returns 500 when the request host is not in the allow-list', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      appBaseUrl: ['https://app1.example.com'],
    });

    const res = await request(app)
      .get('/auth/logout')
      .set('host', 'evil.example.com')
      .set('x-forwarded-proto', 'https');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('InvalidConfigurationError');
  });
});
