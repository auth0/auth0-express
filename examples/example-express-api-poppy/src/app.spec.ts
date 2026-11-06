import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
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
  server.listen({ onUnhandledRequest: 'bypass' });
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  publicJwk = await exportJWK(keys.publicKey);
  agent = await createTestAgent();
});

// The servers that the current test started.
const servers: Server[] = [];

afterEach(async () => {
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
function start(poppy: Auth0ApiPoppyOptions = {}) {
  return serve(
    createApp({
      publicOrigin: PUBLIC_ORIGIN,
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
      .set('Poppy-Session', await session('POST', '/api/cart/items', { sid }))
      .send({ sku: 'sku_shirt' });
    const cart = await api.get('/api/cart').set('Poppy-Session', await session('GET', '/api/cart', { sid }));

    expect(added.status).toBe(201);
    expect(added.body).toEqual({ items: ['sku_shirt'] });
    expect(cart.status).toBe(200);
    expect(cart.body).toEqual({ items: ['sku_shirt'] });
    expect(hits).toEqual({ discovery: 0, jwks: 0 });
  });

  test('asks a signed-out agent to sign in for an order', async () => {
    const api = await start();

    const res = await api.post('/api/orders').set('Poppy-Session', await session('POST', '/api/orders'));

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
      .set('Poppy-Session', await session('POST', '/api/cart/items', { sid }))
      .send({ sku: 'sku_shirt' });

    // The user signs in. The agent now sends an access token too, and its Session JWT vouches for that token.
    const token = await makeToken();
    const order = await api
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Poppy-Session', await session('POST', '/api/orders', { sid, accessToken: token }));
    const cart = await api.get('/api/cart').set('Poppy-Session', await session('GET', '/api/cart', { sid }));

    expect(order.status).toBe(201);
    // `sub` is the account of the access token. The User ID of the Session, which the test agent sets to `usr_test`, is
    // not the account.
    expect(order.body).toEqual({ sub: 'auth0|user_123', items: ['sku_shirt'] });
    expect(cart.body).toEqual({ items: [] });
    expect(hits.jwks).toBeGreaterThan(0);
  });

  test('refuses an expired delegation', async () => {
    const api = await start();
    const sessionJwt = await session('GET', '/api/cart', { defect: 'expired_delegation' });

    const res = await api.get('/api/cart').set('Poppy-Session', sessionJwt);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_session');
  });

  test('refuses a Session whose user changed', async () => {
    const api = await start();
    const sid = 'sid_changed_user';

    const first = await api.get('/api/cart').set('Poppy-Session', await session('GET', '/api/cart', { sid }));
    const second = await api
      .get('/api/cart')
      .set('Poppy-Session', await session('GET', '/api/cart', { sid, sub: 'usr_other' }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_session');
  });

  test('refuses a Session that the store has ended', async () => {
    const store = new RecordingStore();
    const api = await start({ sessionStore: store });
    const sid = 'sid_ended';

    const first = await api.get('/api/cart').set('Poppy-Session', await session('GET', '/api/cart', { sid }));
    store.end(store.keys[0]!);
    const second = await api.get('/api/cart').set('Poppy-Session', await session('GET', '/api/cart', { sid }));

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
      .set('Poppy-Session', await session('POST', '/api/cart/items'))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
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
