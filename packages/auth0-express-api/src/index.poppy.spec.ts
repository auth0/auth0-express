import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import * as jose from 'jose';
import express from 'express';
import type { ErrorRequestHandler, Request, RequestHandler, Router } from 'express';
import request from 'supertest';
import { PoppySessionStore, createAuth0Api, requiresAuth, scopesInclude } from './index.js';
import type { Auth0ApiPoppyOptions, PoppySessionRecord } from './index.js';
import { createTestAgent } from './testing.js';
import type { TestAgent, TestSessionJwtOptions } from './testing.js';
import { serve } from './test-utils/serve.js';
import { generateToken, jwks } from './test-utils/tokens.js';

// These tests run the whole stack: real Express, a real ApiClient from `@auth0/auth0-api-js`, real keys, and the test
// agent for the Personal Agent. Only the Auth0 tenant is faked, with msw. Nothing in the middleware is mocked, so a
// wrong wiring makes a test fail.

const domain = 'auth0.local';
const issuer = `https://${domain}/`;
const audience = 'https://api.example.com';
const publicOrigin = 'https://api.example.com';
const config = { issuer, apis: [{ identifier: audience, public_origin: publicOrigin }] };

// The fixed texts that reach the app. Written out here, so the spec fails when the source changes them.
const POPPY_OPTION_WITHOUT_POPPY_ROUTER =
  'requiresAuth() was given the poppy option, but createAuth0Api() was not. Set the poppy option of createAuth0Api() to verify Poppy Sessions.';
const POPPY_REQUEST_FAILED = 'The request could not be verified.';

// How often the tenant was asked for its discovery document and its keys. They stay 0 for a request that is refused
// before any access token is verified.
const hits = { discovery: 0, jwks: 0 };

const server = setupServer(
  http.get(`https://${domain}/.well-known/openid-configuration`, () => {
    hits.discovery += 1;
    return HttpResponse.json({ issuer, jwks_uri: `https://${domain}/.well-known/jwks.json` });
  }),
  http.get(`https://${domain}/.well-known/jwks.json`, () => {
    hits.jwks += 1;
    return HttpResponse.json({ keys: jwks });
  })
);

let agent: TestAgent;
let agentFetch: Mock<typeof fetch>;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'bypass' });
  agent = await createTestAgent();
  agentFetch = vi.fn(agent.fetch);
});

afterAll(() => server.close());

// What the routes and the error handler saw. The routes keep `req.auth0` and its hidden `token` here, and never send
// them back.
interface Seen {
  runs: number;
  auth0?: Request['auth0'];
  token?: string;
  error?: unknown;
}

let seen: Seen = { runs: 0 };

afterEach(() => {
  hits.discovery = 0;
  hits.jwks = 0;
  agentFetch.mockClear();
  seen = { runs: 0 };
});

const handler: RequestHandler = (req, res) => {
  seen.runs += 1;
  seen.auth0 = req.auth0;
  seen.token = req.auth0.token;
  res.json({ ok: true });
};

// Answers 500 with the message of the error, as an app that reports its errors would, so that a message with detail in
// it shows in the body.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const recordError: ErrorRequestHandler = (error, _req, res, _next) => {
  seen.error = error;
  res
    .status(500)
    .type('text')
    .send(error instanceof Error ? error.message : 'not an Error');
};

function addRoutes(router: Router) {
  router.get('/profile', requiresAuth(), handler);
  router.get('/orders', requiresAuth({ scopes: 'orders:read' }), handler);
  router.get('/orders/both', requiresAuth({ scopes: 'orders:read orders:write' }), handler);
  router.get('/cart', requiresAuth({ poppy: { requireSession: true } }), handler);
  router.post('/orders', requiresAuth({ scopes: 'orders:write', poppy: { requireSession: true } }), handler);
  router.get('/cart/scoped', requiresAuth({ poppy: { requireSession: true } }), scopesInclude('orders:read'), handler);
}

// A new router, and with it a new ApiClient with cold caches, for every test.
async function makeApp(poppy?: Partial<Auth0ApiPoppyOptions>, mount = '') {
  const router = createAuth0Api({
    domain,
    audience,
    poppy: { config, verifySession: true, agentMetadata: { fetch: agentFetch }, ...poppy },
  });
  addRoutes(router);

  const app = express();
  app.use(mount, router);
  app.use(recordError);
  return { app, api: await serve(app) };
}

// The URL an agent signs a Session JWT for: the public origin of the API and the path it calls.
const apiUrl = (path: string) => `${publicOrigin}${path}`;

// The value of the `Poppy-Session` header for one request. The agent signs the method and the URL into it.
function session(htm: string, htu: string, options: Partial<TestSessionJwtOptions> = {}) {
  return agent.createSessionJwt({ aud: issuer, htm, htu, ...options });
}

// An access token for the API, issued to the test agent. `claims` add to the claims or replace them, and the times are
// in seconds.
function makeToken(claims: Record<string, unknown> = {}, times: { issuedAt?: number; expiresAt?: number } = {}) {
  return generateToken(domain, 'user_123', audience, undefined, times.issuedAt, times.expiresAt, {
    azp: agent.cimdUrl,
    scope: 'orders:read orders:write',
    ...claims,
  });
}

function makeExpiredToken(claims: Record<string, unknown> = {}) {
  const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
  return makeToken(claims, { issuedAt: anHourAgo, expiresAt: anHourAgo });
}

// A key for DPoP. The access token is bound to its thumbprint, and the proofs are signed with it.
async function makeDpopKey() {
  const { publicKey, privateKey } = await jose.generateKeyPair('ES256');
  const publicJwk = await jose.exportJWK(publicKey);
  return { privateKey, publicJwk, thumbprint: await jose.calculateJwkThumbprint(publicJwk) };
}

type DpopKey = Awaited<ReturnType<typeof makeDpopKey>>;

// The DPoP proof (RFC 9449) for one request that carries `accessToken`. `htu` is the URL the proof is signed for.
async function makeDpopProof(key: DpopKey, htm: string, htu: string, accessToken: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken));
  const ath = jose.base64url.encode(new Uint8Array(digest));

  return new jose.SignJWT({ htm, htu, jti: crypto.randomUUID(), ath })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk })
    .setIssuedAt()
    .sign(key.privateKey);
}

// The values of a response header, one for each header line. `res.headers` joins repeated lines with ", ", which hides
// how many there were.
function rawHeaders(res: request.Response, name: string): string[] {
  const { rawHeaders: pairs } = (res as unknown as { res: IncomingMessage }).res;
  return pairs.flatMap((value, index) => (index % 2 === 1 && pairs[index - 1]?.toLowerCase() === name ? [value] : []));
}

// The two lines of the sign-in challenge: one for `Bearer` and one for `DPoP`, both naming the scopes to sign in for.
function expectSignInChallenges(res: request.Response, scope: string) {
  const challenges = rawHeaders(res, 'www-authenticate');
  expect(challenges).toHaveLength(2);
  expect(challenges[0]).toMatch(/^Bearer /);
  expect(challenges[1]).toMatch(/^DPoP /);
  for (const challenge of challenges) {
    expect(challenge).toContain(`scope="${scope}"`);
  }
}

// The two lines of the answer to a failed access token: one challenge for `Bearer` and one for `DPoP`. Both are there
// whichever scheme the request used.
function expectBearerAndDpopChallenges(res: request.Response): [bearer: string, dpop: string] {
  const challenges = rawHeaders(res, 'www-authenticate');
  expect(challenges).toHaveLength(2);
  expect(challenges[0]).toMatch(/^Bearer /);
  expect(challenges[1]).toMatch(/^DPoP /);
  return challenges as [string, string];
}

// Checks that the route got the access token that was sent, without the token in the message of a failure.
function expectSameToken(received: string | undefined, sent: string) {
  expect(received === sent, 'the route did not get the access token that was sent').toBe(true);
}

// What a request without an access token gets from `requiresAuth()` on any router: a bare challenge and no body.
function expectBareChallenge(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.headers['www-authenticate']).toBe('Bearer');
  expect(res.text).toBe('');
}

describe('Poppy requests through createAuth0Api()', () => {
  describe('Signed out', () => {
    it('should let a Session without an access token reach a route that sets requireSession', async () => {
      const { api } = await makeApp();
      const sessionJwt = await session('GET', apiUrl('/cart'), { sid: 'sid_signed_out' });

      const res = await api.get('/cart').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(seen.auth0?.poppy).toEqual({
        sessionId: 'sid_signed_out',
        key: expect.any(String),
        userId: 'usr_test',
        agent: { cimdUrl: agent.cimdUrl },
        state: 'signed_out',
        source: 'header',
      });
      expect(seen.auth0?.user).toBeUndefined();
      // A boolean with a message, so that a failure does not print the access token that the route got.
      expect(seen.token === undefined, 'the route got an access token').toBe(true);
      expect(hits).toEqual({ discovery: 0, jwks: 0 });
    });

    it('should answer a Session without an access token with the sign-in challenges on a route that needs scopes', async () => {
      const { api } = await makeApp();
      const sessionJwt = await session('POST', apiUrl('/orders'));

      const res = await api.post('/orders').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(401);
      expectSignInChallenges(res, 'orders:write');
      expect(seen.runs).toBe(0);
    });

    it('should get the 403 of scopesInclude() after a Session passes requiresAuth(), as there are no claims', async () => {
      // The documented limit: requiresAuth() lets the Session through, and scopesInclude() has no claims to check.
      const { api } = await makeApp();
      const sessionJwt = await session('GET', apiUrl('/cart/scoped'));

      const res = await api.get('/cart/scoped').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(403);
      expect(res.headers['www-authenticate']).toBe(
        'Bearer error="insufficient_scope", error_description="Insufficient scopes", scope="orders:read"'
      );
      expect(res.body).toEqual({ error: 'insufficient_scope', error_description: 'Insufficient scopes' });
      expect(seen.runs).toBe(0);
    });
  });

  // Turning verifySession on must not open a route that has not asked for a Session: a valid Session alone gets a 401
  // there, and the route never runs.
  describe('Existing routes stay closed', () => {
    it('should answer a Session alone on a route without the Poppy option with the bare 401', async () => {
      const { api } = await makeApp();
      const sessionJwt = await session('GET', apiUrl('/profile'));

      const res = await api.get('/profile').set('Poppy-Session', sessionJwt);

      expectBareChallenge(res);
      expect(seen.runs).toBe(0);
    });

    it('should answer a Session alone on a route with scopes with the challenges for those scopes', async () => {
      const { api } = await makeApp();
      const sessionJwt = await session('GET', apiUrl('/orders'));

      const res = await api.get('/orders').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(401);
      expectSignInChallenges(res, 'orders:read');
      expect(seen.runs).toBe(0);
    });

    it('should answer a request with no credentials with the bare 401', async () => {
      const { api } = await makeApp();

      const res = await api.get('/profile');

      expectBareChallenge(res);
      expect(seen.runs).toBe(0);
    });
  });

  describe('Signed in', () => {
    it('should run the route for a Session and an access token with the scopes of the route', async () => {
      const { api } = await makeApp();
      const token = await makeToken();
      const sessionJwt = await session('POST', apiUrl('/orders'), { accessToken: token });

      const res = await api.post('/orders').set('Authorization', `Bearer ${token}`).set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(200);
      expect(seen.auth0?.user?.sub).toBe('user_123');
      expect(seen.auth0?.poppy?.state).toBe('signed_in');
      expectSameToken(seen.token, token);
      expect(hits.discovery).toBeGreaterThanOrEqual(1);
      expect(hits.jwks).toBeGreaterThanOrEqual(1);
    });

    it('should answer 403 with the missing scope when the access token lacks a scope of the route', async () => {
      const { api } = await makeApp();
      const token = await makeToken({ scope: 'orders:read' });
      const sessionJwt = await session('POST', apiUrl('/orders'), { accessToken: token });

      const res = await api.post('/orders').set('Authorization', `Bearer ${token}`).set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(403);
      expect(res.headers['www-authenticate']).toContain('scope="orders:write"');
      expect(res.body.error).toBe('insufficient_scope');
      expect(seen.runs).toBe(0);
    });

    it('should answer 400 invalid_session for an access token alone on a route that sets requireSession', async () => {
      const { api } = await makeApp();
      const token = await makeToken();

      const res = await api.get('/cart').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'invalid_session',
        error_description: 'This request needs a verified Session, and it has no Poppy-Session header.',
      });
      expect(seen.runs).toBe(0);
    });
  });

  describe('DPoP', () => {
    it('should verify a DPoP-bound token with a proof for the public URL and give the route the token without its scheme', async () => {
      const { api } = await makeApp();
      const key = await makeDpopKey();
      const token = await makeToken({ cnf: { jkt: key.thumbprint } });
      const proof = await makeDpopProof(key, 'POST', apiUrl('/orders'), token);
      const sessionJwt = await session('POST', apiUrl('/orders'), { accessToken: token });

      const res = await api
        .post('/orders')
        .set('Authorization', `DPoP ${token}`)
        .set('DPoP', proof)
        .set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(200);
      expectSameToken(seen.token, token);
      expect(seen.auth0?.user?.sub).toBe('user_123');
      expect(seen.auth0?.poppy?.state).toBe('signed_in');
    });

    it('should refuse a proof that is signed for the internal URL', async () => {
      const { api } = await makeApp();
      const key = await makeDpopKey();
      const token = await makeToken({ cnf: { jkt: key.thumbprint } });
      const proof = await makeDpopProof(key, 'POST', 'http://127.0.0.1/orders', token);
      const sessionJwt = await session('POST', apiUrl('/orders'), { accessToken: token });

      const res = await api
        .post('/orders')
        .set('Authorization', `DPoP ${token}`)
        .set('DPoP', proof)
        .set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(400);
      expect(rawHeaders(res, 'www-authenticate').join('\n')).toContain('invalid_dpop_proof');
      expect(seen.runs).toBe(0);
    });

    it('should refuse a DPoP-bound token that is sent as Bearer', async () => {
      const { api } = await makeApp();
      const key = await makeDpopKey();
      const token = await makeToken({ cnf: { jkt: key.thumbprint } });
      const sessionJwt = await session('POST', apiUrl('/orders'), { accessToken: token });

      const res = await api.post('/orders').set('Authorization', `Bearer ${token}`).set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(401);
      expect(rawHeaders(res, 'www-authenticate').join('\n')).toContain('invalid_token');
      expect(seen.runs).toBe(0);
    });

    it('should verify a DPoP-bound token and its proof without a Session', async () => {
      const { api } = await makeApp();
      const key = await makeDpopKey();
      const token = await makeToken({ cnf: { jkt: key.thumbprint } });
      const proof = await makeDpopProof(key, 'GET', apiUrl('/profile'), token);

      const res = await api.get('/profile').set('Authorization', `DPoP ${token}`).set('DPoP', proof);

      expect(res.status).toBe(200);
      expectSameToken(seen.token, token);
      expect(seen.auth0?.user?.sub).toBe('user_123');
      expect(seen.auth0?.poppy).toBeUndefined();
    });
  });

  // A bad Session is refused before the access token is looked at (section 5.3 of the Poppy 0.3 specification), so it
  // costs no request to Auth0: the counters of the tenant stay 0.
  describe('Order of checks', () => {
    it('should refuse a Session for another URL before it looks at an expired access token', async () => {
      const { api } = await makeApp();
      const token = await makeExpiredToken();
      const sessionJwt = await session('GET', apiUrl('/elsewhere'), { accessToken: token });

      const res = await api.get('/cart').set('Authorization', `Bearer ${token}`).set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_session');
      expect(hits).toEqual({ discovery: 0, jwks: 0 });
      expect(seen.runs).toBe(0);
    });

    it('should refuse a Session made for another access token before it verifies the one that came', async () => {
      const { api } = await makeApp();
      const token = await makeToken();
      const sessionJwt = await session('GET', apiUrl('/cart'), { accessToken: 'another-token' });

      const res = await api.get('/cart').set('Authorization', `Bearer ${token}`).set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_session');
      expect(hits).toEqual({ discovery: 0, jwks: 0 });
      expect(seen.runs).toBe(0);
    });
  });

  // A Session verifies exactly when its htu is the public origin of the API and the path the agent called, whatever
  // mount path, query, Host header or X-Forwarded header the request has when it reaches Express.
  describe('Request URL', () => {
    it('should verify a Session against the mount path and the path of the route', async () => {
      const { api } = await makeApp({}, '/shop');
      const sessionJwt = await session('GET', apiUrl('/shop/cart'));

      const res = await api.get('/shop/cart').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(200);
      expect(seen.auth0?.poppy?.state).toBe('signed_out');
    });

    it('should refuse a Session that is signed without the mount path', async () => {
      const { api } = await makeApp({}, '/shop');
      const sessionJwt = await session('GET', apiUrl('/cart'));

      const res = await api.get('/shop/cart').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_session');
      expect(seen.runs).toBe(0);
    });

    it('should verify a Session for the path alone when the request has a query', async () => {
      const { api } = await makeApp();
      const sessionJwt = await session('GET', apiUrl('/cart'));

      const res = await api.get('/cart?x=1').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(200);
    });

    it.each([true, false])(
      'should compare the Session with the public origin, whatever Host and X-Forwarded headers say (trust proxy: %s)',
      async (trustProxy) => {
        const { app, api } = await makeApp();
        if (trustProxy) {
          app.set('trust proxy', true);
        }
        const spoofed = (test: request.Test) =>
          test.set('Host', 'evil.example').set('X-Forwarded-Host', 'evil.example').set('X-Forwarded-Proto', 'http');

        const accepted = await spoofed(api.get('/cart')).set('Poppy-Session', await session('GET', apiUrl('/cart')));
        const refused = await spoofed(api.get('/cart')).set(
          'Poppy-Session',
          await session('GET', 'https://evil.example/cart')
        );

        expect(accepted.status).toBe(200);
        expect(refused.status).toBe(400);
        expect(refused.body.error).toBe('invalid_session');
      }
    );

    it.each([true, false])(
      'should take the path from the request line, never from a Host header that carries one (trust proxy: %s)',
      async (trustProxy) => {
        // The ApiClient keeps the path of the URL it is given and puts it behind the public origin. So a URL built from
        // the Host header would do no harm, unless the header holds a path. Node passes such a header on as it is.
        const { app, api } = await makeApp();
        if (trustProxy) {
          app.set('trust proxy', true);
        }
        const withHostPath = (test: request.Test) =>
          test.set('Host', 'evil.example/fake').set('X-Forwarded-Host', 'evil.example/fake');

        const accepted = await withHostPath(api.get('/cart')).set(
          'Poppy-Session',
          await session('GET', apiUrl('/cart'))
        );
        const refused = await withHostPath(api.get('/cart')).set(
          'Poppy-Session',
          await session('GET', apiUrl('/fake/cart'))
        );

        expect(accepted.status).toBe(200);
        expect(refused.status).toBe(400);
        expect(refused.body.error).toBe('invalid_session');
      }
    );

    it('should use the baseUrl option as the public origin when it is set', async () => {
      const { api } = await makeApp({ baseUrl: 'https://public.example.com' });

      const accepted = await api
        .get('/cart')
        .set('Poppy-Session', await session('GET', 'https://public.example.com/cart'));
      const refused = await api.get('/cart').set('Poppy-Session', await session('GET', apiUrl('/cart')));

      expect(accepted.status).toBe(200);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe('invalid_session');
    });
  });

  describe('Session records', () => {
    // A Session store in memory. As the contract asks, `set` keeps the record that is there and resolves to the one
    // that is stored afterwards.
    class MapSessionStore extends PoppySessionStore {
      readonly records = new Map<string, PoppySessionRecord>();

      async get(key: string) {
        return this.records.get(key);
      }

      async set(key: string, record: PoppySessionRecord) {
        if (!this.records.has(key)) {
          this.records.set(key, record);
        }
        return this.records.get(key) ?? record;
      }
    }

    const dbDown = new Error('db down');

    // A store whose database is down.
    class DownSessionStore extends PoppySessionStore {
      async get(): Promise<PoppySessionRecord> {
        throw dbDown;
      }

      async set(): Promise<PoppySessionRecord> {
        throw dbDown;
      }
    }

    it('should save the first request of a Session under its key', async () => {
      const store = new MapSessionStore();
      const { api } = await makeApp({ sessionStore: store });
      const sessionJwt = await session('GET', apiUrl('/cart'), { sid: 'sid_first' });

      const res = await api.get('/cart').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(200);
      expect(seen.auth0?.poppy?.key).toEqual(expect.any(String));
      expect([...store.records]).toEqual([[seen.auth0?.poppy?.key, { userId: 'usr_test' }]]);
    });

    it('should refuse a request for a known Session with another User ID', async () => {
      const { api } = await makeApp({ sessionStore: new MapSessionStore() });
      const first = await session('GET', apiUrl('/cart'), { sid: 'sid_known' });
      const second = await session('GET', apiUrl('/cart'), { sid: 'sid_known', sub: 'usr_other' });

      const accepted = await api.get('/cart').set('Poppy-Session', first);
      const refused = await api.get('/cart').set('Poppy-Session', second);

      expect(accepted.status).toBe(200);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe('invalid_session');
      expect(seen.runs).toBe(1);
    });

    it('should refuse a request for a Session that the store says has ended', async () => {
      const store = new MapSessionStore();
      const { api } = await makeApp({ sessionStore: store });
      const first = await session('GET', apiUrl('/cart'), { sid: 'sid_ended' });
      const second = await session('GET', apiUrl('/cart'), { sid: 'sid_ended' });

      const accepted = await api.get('/cart').set('Poppy-Session', first);
      const key = seen.auth0?.poppy?.key as string;
      store.records.set(key, { userId: 'usr_test', ended: true });
      const refused = await api.get('/cart').set('Poppy-Session', second);

      expect(accepted.status).toBe(200);
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ error: 'session_ended' });
      expect(seen.runs).toBe(1);
    });

    it('should answer 500 with a fixed error when the store fails, and keep the failure out of the response', async () => {
      const { api } = await makeApp({ sessionStore: new DownSessionStore() });
      const sessionJwt = await session('GET', apiUrl('/cart'));

      const res = await api.get('/cart').set('Poppy-Session', sessionJwt);

      const error = seen.error as Error & { status?: number };
      expect(res.status).toBe(500);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(POPPY_REQUEST_FAILED);
      expect(error.status).toBe(500);
      expect(error.cause).toBe(dbDown);
      expect(res.text).toBe(POPPY_REQUEST_FAILED);
      expect(seen.runs).toBe(0);
    });
  });

  describe('Token Session', () => {
    it('should take the Session from the act claim of an access token that has no Poppy-Session header', async () => {
      const { api } = await makeApp();
      const token = await makeToken({
        azp: 'web_app',
        act: { sub: agent.cimdUrl, poppy_sid: 'sid_from_token', poppy_user_id: 'usr_test' },
      });

      const res = await api.get('/cart').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(seen.auth0?.poppy).toEqual({
        sessionId: 'sid_from_token',
        key: expect.any(String),
        userId: 'usr_test',
        agent: { cimdUrl: agent.cimdUrl },
        state: 'signed_in',
        source: 'token',
      });
      expect(seen.auth0?.user?.sub).toBe('user_123');
      expectSameToken(seen.token, token);
    });
  });

  describe('Registered agents and verifySession: false', () => {
    it('should refuse the access token of a registered agent that comes without a Poppy-Session header', async () => {
      const { api } = await makeApp({ agents: [agent.cimdUrl] });
      const token = await makeToken();

      const res = await api.get('/profile').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'invalid_session',
        error_description: "A registered agent's request needs the Poppy-Session header.",
      });
      expect(seen.runs).toBe(0);
    });

    it('should ignore the Session header on a route without requireSession when verifySession is off', async () => {
      const { api } = await makeApp({ verifySession: false });
      const sessionJwt = await session('GET', apiUrl('/profile'));

      const res = await api.get('/profile').set('Poppy-Session', sessionJwt);

      expectBareChallenge(res);
      expect(agentFetch).not.toHaveBeenCalled();
      expect(seen.runs).toBe(0);
    });

    it('should still verify the Session header on a route that sets requireSession when verifySession is off', async () => {
      const { api } = await makeApp({ verifySession: false });
      const sessionJwt = await session('GET', apiUrl('/cart'));

      const res = await api.get('/cart').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(200);
      expect(seen.auth0?.poppy?.state).toBe('signed_out');
      expect(agentFetch).toHaveBeenCalled();
    });
  });

  describe('Router without poppy', () => {
    it('should answer 500 with a fixed error when a route sets the poppy option', async () => {
      const router = createAuth0Api({ domain, audience });
      router.get('/cart', requiresAuth({ poppy: { requireSession: true } }), handler);
      const app = express();
      app.use(router);
      app.use(recordError);
      const api = await serve(app);

      const res = await api.get('/cart');

      expect(res.status).toBe(500);
      expect(seen.error).toBeInstanceOf(Error);
      expect((seen.error as Error).message).toBe(POPPY_OPTION_WITHOUT_POPPY_ROUTER);
      expect(seen.runs).toBe(0);
    });
  });

  // The describe blocks below pin what the Poppy section of EXAMPLES.md says, one block for each claim.

  describe('What changes when you turn it on', () => {
    it('should answer 400 invalid_session for a request with no credentials on a route that sets requireSession', async () => {
      const { api } = await makeApp();

      const res = await api.get('/cart');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_session');
      expect(res.headers['www-authenticate']).toBeUndefined();
      expect(seen.runs).toBe(0);
    });

    it('should run a route without the Poppy option for an access token that comes with no Session', async () => {
      const { api } = await makeApp();
      const token = await makeToken({ azp: 'web_app' });

      const res = await api.get('/profile').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(seen.auth0?.user?.sub).toBe('user_123');
      expect(seen.auth0?.poppy).toBeUndefined();
      expectSameToken(seen.token, token);
    });
  });

  describe('Registered agents', () => {
    const other = 'https://other.example/agent.json';

    it('should answer 400 invalid_session for a Session of an agent that is not on the list, and fetch nothing from it', async () => {
      const { api } = await makeApp({ agents: [other] });
      const sessionJwt = await session('GET', apiUrl('/cart'));

      const res = await api.get('/cart').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_session');
      expect(agentFetch).not.toHaveBeenCalled();
      expect(seen.runs).toBe(0);
    });

    it('should not filter a Session that comes from the act claim of an access token', async () => {
      const { api } = await makeApp({ agents: [other] });
      const token = await makeToken({
        azp: 'web_app',
        act: { sub: agent.cimdUrl, poppy_sid: 'sid_from_token', poppy_user_id: 'usr_test' },
      });

      const res = await api.get('/cart').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(seen.auth0?.poppy?.source).toBe('token');
      expect(seen.auth0?.poppy?.agent.cimdUrl).toBe(agent.cimdUrl);
    });

    it('should take the agents option in place of the agents of the file', async () => {
      const listedByOption = await makeApp({ config: { ...config, agents: [other] }, agents: [agent.cimdUrl] });
      const listedByFile = await makeApp({ config: { ...config, agents: [agent.cimdUrl] }, agents: [other] });
      const sessionJwt = await session('GET', apiUrl('/cart'));

      const accepted = await listedByOption.api.get('/cart').set('Poppy-Session', sessionJwt);
      const refused = await listedByFile.api.get('/cart').set('Poppy-Session', sessionJwt);

      expect(accepted.status).toBe(200);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe('invalid_session');
    });
  });

  describe('A scopes string on a router with and without poppy', () => {
    it('should split a scopes string on spaces on a Poppy router', async () => {
      const { api } = await makeApp();
      const token = await makeToken({ scope: 'orders:read orders:write' });

      const res = await api.get('/orders/both').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('should match a scopes string as one whole scope on a router without poppy', async () => {
      const router = createAuth0Api({ domain, audience });
      addRoutes(router);
      const api = await serve(express().use(router));
      const token = await makeToken({ scope: 'orders:read orders:write' });

      const res = await api.get('/orders/both').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient_scope');
      expect(seen.runs).toBe(0);
    });
  });

  describe('Error responses', () => {
    // Pinned: the status and the parts of the challenges that the table of EXAMPLES.md names. The free text of the
    // `error_description` is not.

    it('should answer 503 with a Retry-After of 30 and a JSON body when the agent cannot be reached', async () => {
      const unreachable = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
      const { api } = await makeApp({ agentMetadata: { fetch: unreachable } });
      const sessionJwt = await session('GET', apiUrl('/cart'));

      const res = await api.get('/cart').set('Poppy-Session', sessionJwt);

      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('30');
      expect(res.body.error).toBe('temporarily_unavailable');
      expect(seen.runs).toBe(0);
    });

    it('should name only the Bearer scheme in the 403 for a DPoP-bound token that lacks a scope', async () => {
      const { api } = await makeApp();
      const key = await makeDpopKey();
      const token = await makeToken({ cnf: { jkt: key.thumbprint }, scope: 'orders:write' });
      const proof = await makeDpopProof(key, 'GET', apiUrl('/orders'), token);

      const res = await api.get('/orders').set('Authorization', `DPoP ${token}`).set('DPoP', proof);

      expect(res.status).toBe(403);
      expect(rawHeaders(res, 'www-authenticate')).toEqual([
        'Bearer error="insufficient_scope", error_description="Insufficient scopes", scope="orders:read"',
      ]);
      expect(res.body.error).toBe('insufficient_scope');
      expect(seen.runs).toBe(0);
    });

    describe('an Authorization header that holds no single Bearer or DPoP credential', () => {
      it.each([
        ['a scheme other than Bearer or DPoP', 'Basic xyz'],
        ['a token and no scheme', 'abc.def.ghi'],
      ])('should answer 400 with challenges that carry no error code, for %s', async (_label, authorization) => {
        const { api } = await makeApp();

        const res = await api.get('/profile').set('Authorization', authorization);

        expect(res.status).toBe(400);
        for (const challenge of expectBearerAndDpopChallenges(res)) {
          expect(challenge).not.toContain('error=');
        }
        expect(res.text).toBe('');
        expect(seen.runs).toBe(0);
      });

      it('should answer 400 with error="invalid_request" on the Bearer challenge for two credentials in one value', async () => {
        const { api } = await makeApp();

        const res = await api.get('/profile').set('Authorization', 'Bearer a, Bearer b');

        const [bearer, dpop] = expectBearerAndDpopChallenges(res);
        expect(res.status).toBe(400);
        expect(bearer).toContain('error="invalid_request"');
        expect(dpop).not.toContain('error=');
        expect(res.text).toBe('');
        expect(seen.runs).toBe(0);
      });

      it.each([['Bearer'], ['DPoP']])(
        'should answer 401 with challenges that carry no error code for %s and no token',
        async (scheme) => {
          const { api } = await makeApp();

          const res = await api.get('/profile').set('Authorization', scheme);

          expect(res.status).toBe(401);
          for (const challenge of expectBearerAndDpopChallenges(res)) {
            expect(challenge).not.toContain('error=');
          }
          expect(res.text).toBe('');
          expect(seen.runs).toBe(0);
        }
      );
    });

    describe('error="invalid_token" on the challenge of the scheme the agent used', () => {
      it('should put it on the Bearer challenge for a token sent as Bearer', async () => {
        const { api } = await makeApp();
        const token = await makeExpiredToken();

        const res = await api.get('/profile').set('Authorization', `Bearer ${token}`);

        const [bearer, dpop] = expectBearerAndDpopChallenges(res);
        expect(res.status).toBe(401);
        expect(bearer).toContain('error="invalid_token"');
        expect(dpop).not.toContain('error=');
        expect(res.text).toBe('');
      });

      it('should put it on the DPoP challenge for a token sent as DPoP', async () => {
        const { api } = await makeApp();
        const key = await makeDpopKey();
        const token = await makeExpiredToken({ cnf: { jkt: key.thumbprint } });
        const proof = await makeDpopProof(key, 'GET', apiUrl('/profile'), token);

        const res = await api.get('/profile').set('Authorization', `DPoP ${token}`).set('DPoP', proof);

        const [bearer, dpop] = expectBearerAndDpopChallenges(res);
        expect(res.status).toBe(401);
        expect(bearer).not.toContain('error=');
        expect(dpop).toContain('error="invalid_token"');
        expect(res.text).toBe('');
      });
    });

    describe('Auth0 unreachable', () => {
      afterEach(() => server.resetHandlers());

      it.each([
        ['the discovery document', `https://${domain}/.well-known/openid-configuration`],
        ['the keys', `https://${domain}/.well-known/jwks.json`],
      ])('should answer 401 with error="invalid_token" when %s cannot be fetched', async (_label, url) => {
        server.use(http.get(url, () => HttpResponse.error()));
        const { api } = await makeApp();
        const token = await makeToken();

        const res = await api.get('/profile').set('Authorization', `Bearer ${token}`);

        const [bearer] = expectBearerAndDpopChallenges(res);
        expect(res.status).toBe(401);
        expect(bearer).toContain('error="invalid_token"');
        expect(seen.runs).toBe(0);
      });
    });
  });
});
