import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import {
  domain,
  server,
  setupTests,
  resetMockConfig,
  parseCookies,
} from '../test-utils/test-setup.js';
import { decrypt } from '../test-utils/encryption.js';
import { createAuth0, startEnterpriseLogin } from '../index.js';

const OIDC_ISSUER_REL = 'http://openid.net/specs/connect/1.0/issuer';

function webfingerFederatedResponse() {
  return HttpResponse.json({
    subject: 'acme.test',
    links: [{ rel: OIDC_ISSUER_REL, href: `https://${domain}/` }],
  });
}

function webfingerNotFederatedResponse() {
  return HttpResponse.json({ subject: 'unknown.test', links: [] });
}

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
      onCallback: async (_req, res) => res.redirect('/dashboard'),
    })
  );
  return app;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
beforeEach(async () => { await setupTests(); });
afterEach(() => {
  resetMockConfig();
  server.resetHandlers();
});

describe('startEnterpriseLogin', () => {
  test('redirects to Auth0 and returns true for a federated domain', async () => {
    server.use(
      http.get(`https://${domain}/.well-known/webfinger`, ({ request: req }) => {
        const url = new URL(req.url);
        if (url.searchParams.get('resource')?.includes('federated.test')) {
          return webfingerFederatedResponse();
        }
        return new HttpResponse(null, { status: 404 });
      })
    );

    const app = createECApp();
    app.post('/login', async (req, res) => {
      const redirected = await startEnterpriseLogin(req, res, { email: 'user@federated.test' });
      if (!redirected) res.redirect('/login?error=not_federated');
    });

    const res = await request(app).post('/login');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location ?? '');
    expect(location.hostname).toBe(domain);
    expect(location.pathname).toBe('/authorize');
    expect(location.searchParams.get('login_hint')).toBe('user@federated.test');
  });

  test('returns false for a non-federated domain', async () => {
    server.use(
      http.get(`https://${domain}/.well-known/webfinger`, () => webfingerNotFederatedResponse())
    );

    const app = createECApp();
    app.post('/login', async (req, res) => {
      const redirected = await startEnterpriseLogin(req, res, { email: 'user@nonfederated.test' });
      if (!redirected) res.redirect('/login?error=not_federated');
    });

    const res = await request(app).post('/login');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?error=not_federated');
  });

  test('stores returnTo in transaction cookie appState', async () => {
    server.use(
      http.get(`https://${domain}/.well-known/webfinger`, ({ request: req }) => {
        const url = new URL(req.url);
        if (url.searchParams.get('resource')?.includes('returnto.test')) {
          return webfingerFederatedResponse();
        }
        return new HttpResponse(null, { status: 404 });
      })
    );

    const app = createECApp();
    app.post('/login', async (req, res) => {
      await startEnterpriseLogin(req, res, {
        email: 'user@returnto.test',
        returnTo: 'http://localhost:3000/dashboard',
      });
    });

    const res = await request(app).post('/login');

    expect(res.status).toBe(302);
    const cookies = parseCookies(res.headers['set-cookie']);
    const txCookie = cookies['__a0_tx'];
    expect(txCookie).toBeDefined();
    const txState = await decrypt<{ appState?: { returnTo?: string } }>(txCookie!, '<secret>', '__a0_tx');
    expect(txState.appState?.returnTo).toBe('http://localhost:3000/dashboard');
  });
});
