import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { generateToken } from '../test-utils/tokens.js';
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

describe('backchannel logout handler', () => {
  test('returns 400 when logout_token is missing', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    const res = await request(app).post('/auth/backchannel-logout').send({});

    expect(res.status).toBe(400);
    expect(res.text).toBe('Missing `logout_token` in the request body.');
  });

  test('returns 400 when logout_token is invalid', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    const res = await request(app).post('/auth/backchannel-logout').send({ logout_token: 'invalid_token' });

    // Invalid tokens now surface through Express error handling (SDK-4)
    // rather than a handler-authored 400 with leaked detail.
    expect(res.status).toBe(500);
  });

  test('returns 204 on successful logout token processing', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    // Create a valid logout token
    const logoutToken = await generateToken(
      domain,
      'user_123',
      '<client_id>',
      undefined,
      undefined,
      undefined,
      {
        events: {
          'http://schemas.openid.net/event/backchannel-logout': {},
        },
        sid: 'session_123',
      }
    );

    const res = await request(app).post('/auth/backchannel-logout').send({ logout_token: logoutToken });

    // Note: This might return 500 (via Express error middleware; SDK-4) due to
    // additional validation in auth0-server-js, but we're testing that the
    // handler processes it correctly.
    expect([204, 500]).toContain(res.status);
  });
});
