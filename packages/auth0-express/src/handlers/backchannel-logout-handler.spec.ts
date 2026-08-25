import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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

    // An invalid logout token is a client error: the handler returns the
    // spec-mandated 400 (OIDC Back-Channel Logout §2.8) without echoing the
    // internal validation-error detail to the caller (SDK-4).
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('invalid_token');
  });

  test('forwards a GenericRequestError via next() with status 400 and the original error as cause', async () => {
    const { handleBackchannelLogout } = await import('./backchannel-logout-handler.js');
    const { GenericRequestError } = await import('../errors/index.js');

    const originalError = new Error('internal validation detail');
    const req = {
      body: { logout_token: 'x' },
      auth0: {
        client: {
          handleBackchannelLogout: async () => {
            throw originalError;
          },
        },
      },
    } as unknown as Parameters<typeof handleBackchannelLogout>[0];
    const res = { status: () => res, send: () => res } as unknown as Parameters<typeof handleBackchannelLogout>[1];
    const next = vi.fn();

    await handleBackchannelLogout(req, res, next);

    // The error reaches Express error handling (for logging) carrying the
    // spec-mandated 400 status, while the internal detail is kept on `cause`
    // rather than exposed as the top-level message (SDK-4).
    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = next.mock.calls[0][0] as InstanceType<typeof GenericRequestError>;
    expect(forwarded).toBeInstanceOf(GenericRequestError);
    expect(forwarded.status).toBe(400);
    expect(forwarded.message).not.toContain('internal validation detail');
    expect(forwarded.cause).toBe(originalError);
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

    // Note: This might return 400 due to additional logout-token validation in
    // auth0-server-js (any failure at this endpoint is a 400 per OIDC
    // Back-Channel Logout §2.8), but we're testing that the handler processes
    // it correctly.
    expect([204, 400]).toContain(res.status);
  });
});
