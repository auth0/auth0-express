import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { JWK } from 'jose';
import request from 'supertest';
import type { Express } from 'express';
import type { Auth0ApiPoppyOptions, PoppySessionRecord } from '@auth0/auth0-express-api';
import { createTestAgent } from '@auth0/auth0-express-api/testing';
import type { TestAgent, TestSessionJwtOptions } from '@auth0/auth0-express-api/testing';
import { createApp } from './app.js';
import { MemoryPoppySessionStore } from './memory-store.js';

// A Personal Agent sends `Poppy-Version` with every request that has the `Poppy-Session` header, and the SDK refuses a
// request without it (spec 3.4).
const withVersion = (jwt: string) => ({ 'Poppy-Session': jwt, 'Poppy-Version': '1.0' });

// The values are placeholders. No test talks to an Auth0 tenant or to a real Personal Agent: msw plays the tenant, and
// a test agent plays the agent.
const AUTH0_DOMAIN = 'tenant.auth0.local';
const ISSUER = `https://${AUTH0_DOMAIN}/`;
const AUDIENCE = 'https://api.example.com';
const PUBLIC_ORIGIN = 'https://shop.example.com';

// createApp() reads these two when it runs. The public origin is passed to it by `start()` below.
process.env.AUTH0_DOMAIN = AUTH0_DOMAIN;
process.env.AUTH0_AUDIENCE = AUDIENCE;

const KID = 'test-key-1';
let privateKey: CryptoKey;
let publicJwk: JWK;
let agent: TestAgent;

// How often the app asked the tenant for its discovery document and its keys. It needs them to verify an access token,
// and a Session alone does not need them.
const hits = { discovery: 0, jwks: 0 };

const server = setupServer(
  http.get(`${ISSUER}.well-known/openid-configuration`, () => {
    hits.discovery += 1;
    return HttpResponse.json({ issuer: ISSUER, jwks_uri: `${ISSUER}.well-known/jwks.json` });
  }),
  http.get(`${ISSUER}.well-known/jwks.json`, () => {
    hits.jwks += 1;
    return HttpResponse.json({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] });
  })
);

beforeAll(async () => {
  server.listen({
    // A request to the app under test, which listens on this machine, goes through. Any other request that no handler
    // covers is stopped (`print.error()` alone only prints, and the request would reach the real host), and the test
    // fails in `afterEach`.
    onUnhandledRequest: (request, print) => {
      if (['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url).hostname)) return;
      unhandled.push(`${request.method} ${request.url}`);
      print.error();
      throw new Error(`A request has no handler: ${request.method} ${request.url}`);
    },
  });
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  publicJwk = await exportJWK(keys.publicKey);
  agent = await createTestAgent();
});

// The servers that the current test started.
const servers: Server[] = [];

// The requests that no handler covers and that are not for the app under test.
const unhandled: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  expect(unhandled.splice(0), 'requests that no msw handler covers').toEqual([]);
  hits.discovery = 0;
  hits.jwks = 0;

  await Promise.all(
    servers.splice(0).map(
      (started) =>
        new Promise<void>((resolve) => {
          started.close(() => resolve());
          started.closeAllConnections();
        })
    )
  );
});

afterAll(() => server.close());

// Starts the app on a free port of 127.0.0.1 and returns a supertest client for it. supertest on its own listens on
// every address and then connects to 127.0.0.1, where another program that listens on that port can get the request.
async function serve(app: Express) {
  const started = createServer(app);
  servers.push(started);
  await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
  return request(started);
}

// A new app for every test: new caches, an empty Session store and no carts. `poppy` replaces what the app would use.
function start(poppy: Partial<Auth0ApiPoppyOptions> = {}) {
  return serve(
    createApp({
      publicOrigin: PUBLIC_ORIGIN,
      agents: [agent.cimdUrl],
      agentMetadata: { fetch: agent.fetch },
      ...poppy,
    })
  );
}

// A store that remembers the keys it saved, so that a test can end a Session without knowing how its key is made.
class RecordingStore extends MemoryPoppySessionStore {
  readonly keys: string[] = [];

  override async set(key: string, record: PoppySessionRecord): Promise<PoppySessionRecord> {
    this.keys.push(key);
    return super.set(key, record);
  }
}

// The value of the Poppy-Session header for one request. The agent signs the method and the public URL of the request
// into it, and `options` can set the Session ID (`sid`) and the access token that the request carries.
function session(method: string, path: string, options: Partial<TestSessionJwtOptions> = {}) {
  return agent.createSessionJwt({ aud: ISSUER, htm: method, htu: PUBLIC_ORIGIN + path, ...options });
}

// An access token for the API, as Auth0 issues it to the agent once the user has signed in.
function makeToken() {
  return new SignJWT({ azp: agent.cimdUrl, scope: 'orders:write' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject('auth0|user_123')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

// The access token of the web app of a guest: an anonymous user whom the agent joined to the web app before they signed
// in. It is a valid token with the scope, but it has no account behind it, and its `act` claim holds the Session.
function makeGuestToken() {
  return new SignJWT({
    azp: 'web_app',
    scope: 'orders:write',
    sub_profile: 'user urn:auth0:anonymous_user',
    act: { sub: agent.cimdUrl, poppy_sid: 'sid_guest', poppy_user_id: 'usr_test' },
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject('anon_poppy@b_wzya665QRXJiNwauv_Y69mOaXNyTFMFlpU54QqhHc')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

// The access token of the web app that joined an agent to its user, which holds the Session in its `act` claim. `sub` is
// a signed-in user, so only the agent decides what happens.
function makeWebAppToken(agentId: string, act: Record<string, unknown> = {}) {
  return new SignJWT({
    azp: 'web_app',
    scope: 'orders:write',
    act: { sub: agentId, poppy_sid: 'sid_web_app', poppy_user_id: 'usr_test', ...act },
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject('auth0|user_123')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

// The values of a response header, one for each header line. supertest joins repeated lines with ", ", which would hide
// that there are two.
function headerLines(res: request.Response, name: string): string[] {
  const { rawHeaders } = (res as unknown as { res: IncomingMessage }).res;
  return rawHeaders.filter((_, index) => index % 2 === 1 && rawHeaders[index - 1]?.toLowerCase() === name);
}

describe('example-express-api-poppy', () => {
  test('adds to the cart while signed out', async () => {
    const api = await start();
    const sid = 'sid_signed_out';

    const added = await api
      .post('/api/cart/items')
      .set(withVersion(await session('POST', '/api/cart/items', { sid })))
      .send({ sku: 'sku_shirt' });
    const cart = await api.get('/api/cart').set(withVersion(await session('GET', '/api/cart', { sid })));

    expect(added.status).toBe(201);
    expect(added.body).toEqual({ items: ['sku_shirt'] });
    expect(cart.status).toBe(200);
    expect(cart.body).toEqual({ items: ['sku_shirt'] });
    expect(hits).toEqual({ discovery: 0, jwks: 0 });
  });

  test('asks a signed-out agent to sign in for an order', async () => {
    const api = await start();

    const res = await api.post('/api/orders').set(withVersion(await session('POST', '/api/orders')));

    // One challenge for Bearer and one for DPoP, both naming the scope to sign in for.
    const challenges = headerLines(res, 'www-authenticate');
    expect(res.status).toBe(401);
    expect(challenges).toHaveLength(2);
    expect(challenges[0]).toMatch(/^Bearer /);
    expect(challenges[1]).toMatch(/^DPoP /);
    for (const challenge of challenges) {
      expect(challenge).toContain('scope="orders:write"');
    }
  });

  test('places the order once signed in, with the same cart', async () => {
    const api = await start();
    const sid = 'sid_signed_in';
    await api
      .post('/api/cart/items')
      .set(withVersion(await session('POST', '/api/cart/items', { sid })))
      .send({ sku: 'sku_shirt' });

    // The user signs in. The agent now sends an access token too, and its Session JWT vouches for that token.
    const token = await makeToken();
    const order = await api
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .set(withVersion(await session('POST', '/api/orders', { sid, accessToken: token })));
    const cart = await api.get('/api/cart').set(withVersion(await session('GET', '/api/cart', { sid })));

    expect(order.status).toBe(201);
    // `sub` is the account of the access token. The User ID of the Session, which the test agent sets to `usr_test`, is
    // not the account.
    expect(order.body).toEqual({ sub: 'auth0|user_123', items: ['sku_shirt'] });
    expect(cart.body).toEqual({ items: [] });
    expect(hits.jwks).toBeGreaterThan(0);
  });

  test('does not let a guest place an order, though its token has the scope', async () => {
    const api = await start();
    const token = await makeGuestToken();

    const res = await api.post('/api/orders').set('Authorization', `Bearer ${token}`);

    const challenges = headerLines(res, 'www-authenticate');
    expect(res.status).toBe(401);
    // One challenge for Bearer and one for DPoP, both naming the scope. The loop alone would pass with none.
    expect(challenges).toHaveLength(2);
    for (const challenge of challenges) {
      expect(challenge).toContain('scope="orders:write"');
    }
    expect(res.body).toEqual({});
  });

  test('refuses the token Session of an agent that is not on the list, though the web app that joined it is', async () => {
    const api = await start();
    const unlisted = await makeWebAppToken('https://attacker.example/agent.json');
    const listed = await makeWebAppToken(agent.cimdUrl);

    const refused = await api.get('/api/cart').set('Authorization', `Bearer ${unlisted}`);
    const accepted = await api.get('/api/cart').set('Authorization', `Bearer ${listed}`);

    // The `agents` option filters the header only, so the app checks the agent of a token Session itself.
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('agent_not_allowed');
    expect(accepted.status).toBe(200);
  });

  // An agent that is linked to an Auth0 agent has its ID in `act.sub` and no URL, and the `agents` option takes URLs only,
  // so such an agent is never on the list and the app refuses it. The comment of `listedAgentsOnly()` says so.
  test('refuses the token Session of an agent that is linked to an Auth0 agent, whose ID is not a URL', async () => {
    const api = await start();
    const linked = await makeWebAppToken('agt_3Lp9', {
      sub_profile: 'ai_agent',
      client_id: 'Jf3kPq9Xz2LmN8vTbR5sW1yCdE7hGaUo',
      iss: ISSUER,
    });

    const res = await api.get('/api/cart').set('Authorization', `Bearer ${linked}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('agent_not_allowed');
  });

  test('answers an error with a JSON body that has no detail', async () => {
    const failing = new (class extends MemoryPoppySessionStore {
      override async get(): Promise<PoppySessionRecord | undefined> {
        throw new Error('db down at /srv/shop/secret-path');
      }
    })();
    const api = await start({ sessionStore: failing });

    const res = await api.get('/api/cart').set(withVersion(await session('GET', '/api/cart')));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'server_error' });
    expect(res.text).not.toContain('secret-path');
  });

  test('answers a body that is not JSON with 400, and no stack', async () => {
    const api = await start();

    const res = await api
      .post('/api/cart/items')
      .set(withVersion(await session('POST', '/api/cart/items')))
      .set('Content-Type', 'application/json')
      .send('{ not json');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request' });
  });

  test('refuses an expired delegation', async () => {
    const api = await start();
    const sessionJwt = await session('GET', '/api/cart', { defect: 'expired_delegation' });

    const res = await api.get('/api/cart').set(withVersion(sessionJwt));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_session');
  });

  test('keeps two users who picked the same Session ID apart', async () => {
    const api = await start();
    const sid = 'sid_two_users';

    await api
      .post('/api/cart/items')
      .set(withVersion(await session('POST', '/api/cart/items', { sid })))
      .send({ sku: 'sku_1' });
    const other = await api
      .get('/api/cart')
      .set(withVersion(await session('GET', '/api/cart', { sid, sub: 'usr_other' })));
    const first = await api.get('/api/cart').set(withVersion(await session('GET', '/api/cart', { sid })));

    // A Session is found by Session ID and User ID, so the other user has a cart of their own.
    expect(other.status).toBe(200);
    expect(other.body).toEqual({ items: [] });
    expect(first.body.items).toHaveLength(1);
  });

  test('refuses a request without Poppy-Version', async () => {
    const api = await start();

    const res = await api.get('/api/cart').set('Poppy-Session', await session('GET', '/api/cart'));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('version_unsupported');
  });

  test('refuses a Session that the store has ended', async () => {
    const store = new RecordingStore();
    const api = await start({ sessionStore: store });
    const sid = 'sid_ended';

    const first = await api.get('/api/cart').set(withVersion(await session('GET', '/api/cart', { sid })));
    store.end(store.keys[0]!);
    const second = await api.get('/api/cart').set(withVersion(await session('GET', '/api/cart', { sid })));

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('session_ended');
  });

  test.each([
    ['no body', undefined],
    ['a sku that is a number', { sku: 5 }],
    ['an empty sku', { sku: '' }],
  ])('refuses an item with %s', async (_label, body) => {
    const api = await start();

    const res = await api
      .post('/api/cart/items')
      .set(withVersion(await session('POST', '/api/cart/items')))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });
});

describe('createApp', () => {
  test.each([
    ['no agents', undefined],
    ['an empty list of agents', []],
  ])('does not start with %s', (_label, agents) => {
    expect(() => createApp({ publicOrigin: PUBLIC_ORIGIN, agents })).toThrow('Set POPPY_AGENTS');
  });

  test('does not start without a public origin', () => {
    // The environment may set it, so the test takes it away.
    vi.stubEnv('API_PUBLIC_ORIGIN', '');

    expect(() => createApp({ agents: [agent.cimdUrl] })).toThrow('Set API_PUBLIC_ORIGIN');
  });
});

describe('MemoryPoppySessionStore', () => {
  const first = { userId: 'usr_1' };
  const second = { userId: 'usr_2' };

  test('returns the record it stored, and nothing for a key it has not seen', async () => {
    const store = new MemoryPoppySessionStore();

    expect(await store.get('key_1')).toBeUndefined();
    expect(await store.set('key_1', first)).toBe(first);
    expect(await store.get('key_1')).toBe(first);
  });

  test('keeps the first record of a key and resolves to it', async () => {
    const store = new MemoryPoppySessionStore();
    await store.set('key_1', first);

    expect(await store.set('key_1', second)).toBe(first);
    expect(await store.get('key_1')).toBe(first);
  });

  test('stores one record when two requests of a Session set it together', async () => {
    const store = new MemoryPoppySessionStore();

    const [a, b] = await Promise.all([store.set('key_1', first), store.set('key_1', second)]);

    expect(a).toBe(first);
    expect(b).toBe(first);
    expect(await store.get('key_1')).toBe(first);
  });

  test('ends a Session and keeps the rest of its record', async () => {
    const store = new MemoryPoppySessionStore();
    await store.set('key_1', first);

    store.end('key_1');

    expect(await store.get('key_1')).toEqual({ userId: 'usr_1', ended: true });
  });

  test('ignores a key it has not seen when it ends a Session', async () => {
    const store = new MemoryPoppySessionStore();

    store.end('key_1');

    expect(await store.get('key_1')).toBeUndefined();
  });
});
