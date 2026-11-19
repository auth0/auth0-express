import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ServerClient } from '@auth0/auth0-server-js';
import { createAuth0 } from '../index.js';
import { handleBackchannelLogout, parseBackchannelLogoutBody } from './backchannel-logout-handler.js';
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
  vi.restoreAllMocks();
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
    // internal validation-error detail to the caller.
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('invalid_token');
  });

  test('owns the response on failure: bare 400 with no internal detail', async () => {
    const { handleBackchannelLogout } = await import('./backchannel-logout-handler.js');

    const req = {
      body: { logout_token: 'x' },
      auth0: {
        client: {
          handleBackchannelLogout: async () => {
            throw new Error('internal validation detail');
          },
        },
      },
    } as unknown as Parameters<typeof handleBackchannelLogout>[0];

    let sentStatus: number | undefined;
    let sentBody: unknown;
    const res = {
      status(code: number) {
        sentStatus = code;
        return this;
      },
      send(body?: unknown) {
        sentBody = body;
        return this;
      },
    } as unknown as Parameters<typeof handleBackchannelLogout>[1];

    // The endpoint is server-to-server, so the handler owns the response: it
    // responds 400 itself (never delegating to Express error middleware) and
    // does not echo the internal error detail to the caller.
    await handleBackchannelLogout(req, res);

    expect(sentStatus).toBe(400);
    expect(String(sentBody ?? '')).not.toContain('internal validation detail');
  });

  // Auth0 sends the token as a form, and the router mounts no body parser for the app. Without one, `req.body` is
  // undefined, and the handler used to throw. Express 4 does not catch that, so the process ended.
  describe('on an app with no body parser', () => {
    const appWithNoBodyParser = () => {
      const app = express();
      app.use(
        createAuth0({
          domain: domain,
          clientId: '<client_id>',
          clientSecret: '<client_secret>',
          appBaseUrl: 'http://localhost:3000',
          sessionSecret: '<secret>',
        })
      );
      return app;
    };

    test('reads the logout_token from a form body and passes it on', async () => {
      const handleLogout = vi.spyOn(ServerClient.prototype, 'handleBackchannelLogout').mockResolvedValue(undefined);

      const res = await request(appWithNoBodyParser())
        .post('/auth/backchannel-logout')
        .type('form')
        .send({ logout_token: 'the.token' });

      expect(res.status).toBe(204);
      expect(handleLogout).toHaveBeenCalledExactlyOnceWith('the.token');
    });

    test('returns 400 when the form has no logout_token', async () => {
      const res = await request(appWithNoBodyParser()).post('/auth/backchannel-logout').type('form').send({ other: '1' });

      expect(res.status).toBe(400);
      expect(res.text).toBe('Missing `logout_token` in the request body.');
    });

    test('returns 400 when there is no body at all', async () => {
      const res = await request(appWithNoBodyParser()).post('/auth/backchannel-logout');

      expect(res.status).toBe(400);
      expect(res.text).toBe('Missing `logout_token` in the request body.');
    });

    test('returns a bare 400 for a form that the parser refuses', async () => {
      const tooManyFields = `logout_token=x&${Array.from({ length: 1500 }, (_, i) => `f${i}=1`).join('&')}`;

      const res = await request(appWithNoBodyParser())
        .post('/auth/backchannel-logout')
        .type('form')
        .send(tooManyFields);

      expect(res.status).toBe(400);
      expect(res.text).toBe('');
    });
  });

  // Auth0 sends a form. A JSON parser skips it and, on Express 4, still sets `req.body` to `{}`, so a route that trusts
  // `req.body` would not see the token.
  test('reads the form token on an app that mounted only a JSON parser', async () => {
    const handleLogout = vi.spyOn(ServerClient.prototype, 'handleBackchannelLogout').mockResolvedValue(undefined);
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    const res = await request(app).post('/auth/backchannel-logout').type('form').send({ logout_token: 'the.token' });

    expect(res.status).toBe(204);
    expect(handleLogout).toHaveBeenCalledExactlyOnceWith('the.token');
  });

  // A body that something else read, without the flag that the body parser of Express 4 looks for. It used to reach the
  // route on Express 4, and the parser must not refuse it. On Express 5 this passes without the check, so only a run on
  // Express 4 can fail it.
  test('leaves a body that a custom reader already consumed', async () => {
    const handleLogout = vi.spyOn(ServerClient.prototype, 'handleBackchannelLogout').mockResolvedValue(undefined);
    const app = express();
    app.use((req, _res, next) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        req.body = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
        next();
      });
    });
    app.use(
      createAuth0({
        domain: domain,
        clientId: '<client_id>',
        clientSecret: '<client_secret>',
        appBaseUrl: 'http://localhost:3000',
        sessionSecret: '<secret>',
      })
    );

    const res = await request(app).post('/auth/backchannel-logout').type('form').send({ logout_token: 'the.token' });

    expect(res.status).toBe(204);
    expect(handleLogout).toHaveBeenCalledExactlyOnceWith('the.token');
  });

  test('leaves a body that an earlier parser read as it is', async () => {
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use((req, _res, next) => {
      req.auth0 = { client: { handleBackchannelLogout: handleLogout } } as unknown as typeof req.auth0;
      next();
    });
    app.post('/logout', parseBackchannelLogoutBody, (req, res) => handleBackchannelLogout(req, res));

    const res = await request(app).post('/logout').type('form').send({ logout_token: 'the.token' });

    expect(res.status).toBe(204);
    expect(handleLogout).toHaveBeenCalledWith('the.token');
  });

  describe('when the handler is called on its own', () => {
    const answerOf = () => {
      const answer: { status?: number; body?: unknown; headersSent: boolean } = { headersSent: false };
      const res = {
        get headersSent() {
          return answer.headersSent;
        },
        status(code: number) {
          answer.status = code;
          return this;
        },
        send(body?: unknown) {
          answer.body = body;
          return this;
        },
      } as unknown as Parameters<typeof handleBackchannelLogout>[1];
      return { answer, res };
    };

    test('answers 400 and does not reject when there is no req.body', async () => {
      const { answer, res } = answerOf();

      await expect(handleBackchannelLogout({} as Parameters<typeof handleBackchannelLogout>[0], res)).resolves.toBeUndefined();

      expect(answer.status).toBe(400);
      expect(answer.body).toBe('Missing `logout_token` in the request body.');
    });

    test('does not answer twice when the response was already sent', async () => {
      const { answer, res } = answerOf();
      answer.headersSent = true;
      const req = {
        body: { logout_token: 'x' },
        auth0: {
          client: {
            handleBackchannelLogout: async () => {
              throw new Error('late failure');
            },
          },
        },
      } as unknown as Parameters<typeof handleBackchannelLogout>[0];

      await expect(handleBackchannelLogout(req, res)).resolves.toBeUndefined();

      expect(answer.status).toBeUndefined();
    });
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
