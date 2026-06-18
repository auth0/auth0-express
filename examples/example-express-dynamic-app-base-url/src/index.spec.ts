import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import type { Express } from 'express';

// Single Auth0 domain; the dynamic behaviour under test is the per-request
// base URL (redirect_uri) resolved from the APP_BASE_URL allow-list. These must
// be set BEFORE importing the app, which reads process.env at import time.
const AUTH0_DOMAIN = 'tenant.auth0.local';

process.env.AUTH0_DOMAIN = AUTH0_DOMAIN;
process.env.AUTH0_CLIENT_ID = '<client_id>';
process.env.AUTH0_CLIENT_SECRET = '<client_secret>';
process.env.AUTH0_SESSION_SECRET = '<a-session-secret-of-at-least-32-chars>';
process.env.APP_BASE_URL = 'http://app1.localhost:3000,http://app2.localhost:3000';

// A minimal OIDC discovery document. /auth/login only needs the
// authorization_endpoint to build the 302, so that is all we mock.
const discoveryDocument = {
  issuer: `https://${AUTH0_DOMAIN}/`,
  authorization_endpoint: `https://${AUTH0_DOMAIN}/authorize`,
  token_endpoint: `https://${AUTH0_DOMAIN}/oauth/token`,
  end_session_endpoint: `https://${AUTH0_DOMAIN}/logout`,
};

const server = setupServer(
  http.get(`https://${AUTH0_DOMAIN}/.well-known/openid-configuration`, () =>
    HttpResponse.json(discoveryDocument)
  )
);

let app: Express;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'bypass' });
  // Import after env is set. start() is guarded, so importing does not bind a port.
  ({ app } = await import('./index.js'));
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('example-express-dynamic-app-base-url: per-host base URL resolution', () => {
  test('login from app1 host uses app1 as the redirect_uri origin', async () => {
    const res = await request(app).get('/auth/login').set('Host', 'app1.localhost:3000');
    const location = new URL(res.headers['location']?.toString() ?? '');

    expect(res.status).toBe(302);
    expect(location.host).toBe(AUTH0_DOMAIN);
    expect(location.pathname).toBe('/authorize');
    expect(new URL(location.searchParams.get('redirect_uri') ?? '').origin).toBe(
      'http://app1.localhost:3000'
    );
  });

  test('login from app2 host uses app2 as the redirect_uri origin', async () => {
    const res = await request(app).get('/auth/login').set('Host', 'app2.localhost:3000');
    const location = new URL(res.headers['location']?.toString() ?? '');

    expect(res.status).toBe(302);
    expect(location.host).toBe(AUTH0_DOMAIN);
    expect(location.pathname).toBe('/authorize');
    expect(new URL(location.searchParams.get('redirect_uri') ?? '').origin).toBe(
      'http://app2.localhost:3000'
    );
  });
});
