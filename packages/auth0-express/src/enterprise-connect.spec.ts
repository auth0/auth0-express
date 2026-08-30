import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { ServerClient } from '@auth0/auth0-server-js';
import { domain, server, setupTests, resetMockConfig } from './test-utils/test-setup.js';
import { createAuth0 } from './index.js';
import type { StoreOptions } from './types.js';

function createECApp() {
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
      onCallback: vi.fn(async (_req, res) => res.redirect('/dashboard')),
    })
  );
  return app;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
beforeEach(async () => { await setupTests(); });
afterEach(() => { resetMockConfig(); server.resetHandlers(); });

describe('EC mode - method enforcement', () => {
  const blockedMethods: Array<{ name: string; call: (client: ServerClient<StoreOptions>) => Promise<unknown> }> = [
    { name: 'getUser', call: (c) => c.getUser() },
    { name: 'getAccessToken', call: (c) => c.getAccessToken() },
    { name: 'getAccessTokenForConnection', call: (c) => c.getAccessTokenForConnection({ connection: 'test' }) },
  ];

  for (const { name, call } of blockedMethods) {
    test(`${name}() throws EnterpriseConnectNotSupportedError`, async () => {
      const app = createECApp();
      app.get('/test', async (req, res) => {
        try {
          await call(req.auth0.client);
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ error: (e as Error).name });
        }
      });

      const res = await request(app).get('/test');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('EnterpriseConnectNotSupportedError');
    });
  }

  test('allowed methods remain callable in EC mode', async () => {
    const app = createECApp();
    app.get('/test', async (req, res) => {
      // startInteractiveLogin, startEnterpriseLogin, completeInteractiveLogin, logout are all allowed
      const isAllowed = typeof req.auth0.client.startEnterpriseLogin === 'function' &&
        typeof req.auth0.client.startInteractiveLogin === 'function' &&
        typeof req.auth0.client.logout === 'function';
      res.json({ isAllowed });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.isAllowed).toBe(true);
  });
});
