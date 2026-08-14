import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import type { Express } from 'express';

// Auth0 custom domains the resolver maps each host to. These must be set BEFORE
// importing the app, which reads process.env at import time to build its
// host -> domain map and to call createAuth0().
const DEFAULT_DOMAIN = 'default.auth0.local';
const CUSTOM_DOMAIN_1 = 'brand-a.auth0.local';
const CUSTOM_DOMAIN_2 = 'brand-b.auth0.local';

process.env.AUTH0_DOMAIN = DEFAULT_DOMAIN;
process.env.AUTH0_CUSTOM_DOMAIN_1 = CUSTOM_DOMAIN_1;
process.env.AUTH0_CUSTOM_DOMAIN_2 = CUSTOM_DOMAIN_2;
process.env.AUTH0_CLIENT_ID = '<client_id>';
process.env.AUTH0_CLIENT_SECRET = '<client_secret>';
process.env.AUTH0_SESSION_SECRET = '<a-session-secret-of-at-least-32-chars>';
process.env.APP_BASE_URL = 'http://brand-a.localhost:3000,http://brand-b.localhost:3000';

// A minimal OIDC discovery document. /auth/login only needs the
// authorization_endpoint to build the 302, so that is all we mock.
const discoveryDocument = (domain: string) => ({
  issuer: `https://${domain}/`,
  authorization_endpoint: `https://${domain}/authorize`,
  token_endpoint: `https://${domain}/oauth/token`,
  end_session_endpoint: `https://${domain}/logout`,
});

const server = setupServer(
  ...[DEFAULT_DOMAIN, CUSTOM_DOMAIN_1, CUSTOM_DOMAIN_2].map((domain) =>
    http.get(`https://${domain}/.well-known/openid-configuration`, () =>
      HttpResponse.json(discoveryDocument(domain))
    )
  )
);

let app: Express;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'bypass' });
  // Import after env is set so the module builds its host map correctly. The
  // start() call is guarded, so importing does not bind a port.
  ({ app } = await import('./index.js'));
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('example-express-mcd: per-host domain resolution', () => {
  test('login from brand-a host authorizes against the first custom domain', async () => {
    const res = await request(app).get('/auth/login').set('Host', 'brand-a.localhost:3000');
    const location = new URL(res.headers['location']?.toString() ?? '');

    expect(res.status).toBe(302);
    expect(location.host).toBe(CUSTOM_DOMAIN_1);
    expect(location.pathname).toBe('/authorize');
    expect(new URL(location.searchParams.get('redirect_uri') ?? '').origin).toBe(
      'http://brand-a.localhost:3000'
    );
  });

  test('login from brand-b host authorizes against the second custom domain', async () => {
    const res = await request(app).get('/auth/login').set('Host', 'brand-b.localhost:3000');
    const location = new URL(res.headers['location']?.toString() ?? '');

    expect(res.status).toBe(302);
    expect(location.host).toBe(CUSTOM_DOMAIN_2);
    expect(location.pathname).toBe('/authorize');
    expect(new URL(location.searchParams.get('redirect_uri') ?? '').origin).toBe(
      'http://brand-b.localhost:3000'
    );
  });
});
