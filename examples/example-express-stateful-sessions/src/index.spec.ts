import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import request from 'supertest';
import type { Express } from 'express';
import type { InMemorySessionStore } from './session-store.js';

// Env must be set BEFORE importing the app (the SDK reads process.env at import
// time). Values are placeholders; the network is fully mocked.
const AUTH0_DOMAIN = 'tenant.auth0.local';
const CLIENT_ID = '<client_id>';

process.env.AUTH0_DOMAIN = AUTH0_DOMAIN;
process.env.AUTH0_CLIENT_ID = CLIENT_ID;
process.env.AUTH0_CLIENT_SECRET = '<client_secret>';
process.env.AUTH0_SESSION_SECRET = 'a-session-secret-of-at-least-32-characters-long';
process.env.APP_BASE_URL = 'http://localhost:3000';

const KID = 'test-key-1';
let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;

const discovery = {
  issuer: `https://${AUTH0_DOMAIN}/`,
  authorization_endpoint: `https://${AUTH0_DOMAIN}/authorize`,
  token_endpoint: `https://${AUTH0_DOMAIN}/oauth/token`,
  end_session_endpoint: `https://${AUTH0_DOMAIN}/logout`,
  jwks_uri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
};

const server = setupServer(
  http.get(`https://${AUTH0_DOMAIN}/.well-known/openid-configuration`, () =>
    HttpResponse.json(discovery)
  ),
  http.get(discovery.jwks_uri, () =>
    HttpResponse.json({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] })
  ),
  http.post(discovery.token_endpoint, async () => {
    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({ name: 'Jane Doe' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(discovery.issuer)
      .setAudience(CLIENT_ID)
      .setSubject('auth0|user_123')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
    return HttpResponse.json({
      access_token: 'opaque-access-token',
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  })
);

// Join a Set-Cookie header into a Cookie request header (name=value pairs).
const cookieHeader = (h: string | string[] | undefined) =>
  (Array.isArray(h) ? h : [h ?? '']).map((c) => c.split(';')[0]).join('; ');

// Whether a Set-Cookie header contains an entry for the given cookie name.
const hasCookie = (h: string | string[] | undefined, name: string): boolean =>
  (Array.isArray(h) ? h : [h ?? '']).some((c) => c.startsWith(`${name}=`));

let app: Express;
let sessionStore: InMemorySessionStore;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'bypass' });
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey as CryptoKey;
  publicJwk = await exportJWK(kp.publicKey);
  ({ app, sessionStore } = await import('./index.js'));
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Drives login -> callback and returns the resulting Set-Cookie header.
async function login(): Promise<string | string[] | undefined> {
  const loginRes = await request(app).get('/auth/login');
  expect(loginRes.status).toBe(302);
  const txCookie = cookieHeader(loginRes.headers['set-cookie']);

  const cbRes = await request(app).get('/auth/callback').query({ code: 'fake-code' }).set('Cookie', txCookie);
  expect(cbRes.status).toBe(302);
  return cbRes.headers['set-cookie'];
}

describe('example-express-stateful-sessions', () => {
  test('a successful login persists the session data in the server-side store', async () => {
    const before = sessionStore.size;

    const setCookie = await login();

    // The session now lives server-side: the store grew by exactly one entry...
    expect(sessionStore.size).toBe(before + 1);

    // ...and that entry holds the actual session data (the authenticated user
    // and tokens). With the default stateless store this data would instead be
    // encrypted inside the cookie.
    const keys = sessionStore.keys();
    expect(keys).toHaveLength(before + 1);
    const stored = await sessionStore.get(keys[keys.length - 1]!);
    expect(stored?.user?.sub).toBe('auth0|user_123');

    // A session cookie is still set, but it only carries an (encrypted)
    // reference to the server-side entry — not the session data itself.
    expect(hasCookie(setCookie, '__a0_session')).toBe(true);
  });

  test('the persisted session grants access to a protected route', async () => {
    const setCookie = await login();
    const sessionCookie = cookieHeader(setCookie);

    const privRes = await request(app).get('/private').set('Cookie', sessionCookie);

    expect(privRes.status).toBe(200);
    expect(privRes.text).toContain('This is a private page');
  });
});
