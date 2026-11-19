import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { createServer } from 'node:http';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SignJWT, generateKeyPair } from 'jose';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from './app.js';

// No test talks to an Auth0 tenant or to a real Personal Agent. msw plays the tenant, and each test plays the browser
// that an agent drives, through the real login and callback routes of the app. The values are placeholders.
const ISSUER = 'https://tenant.auth0.local/';
const CLIENT_ID = 'web_app_client';
const APP_BASE_URL = 'https://zepto.example';

// What Auth0 puts in the ID token after an agent's browser has joined a Poppy Session. A guest is a join that has no
// signed-in user, and its `sub` and `sub_profile` say so.
const AGENT_URL = 'https://agent.example/agent.json';
const SESSION_ID = 'Yx2b7Qd_Kp8mR3vT1nWc4A';
const USER_ID = 'usr_Q7c1vK';
const ACT = { sub: AGENT_URL, poppy_sid: SESSION_ID, poppy_user_id: USER_ID };
const GUEST_SUB = 'anon_poppy@z4eHq6gTjlgaMSjrplb3j5j3kb3hEDz9hZx8mgdxQLg';
const GUEST_SUB_PROFILE = 'user urn:auth0:anonymous_user';
const AGENT_USER_SUB = 'auth0|ana';

// The login link of an agent's browser: the issuer and the page to land on, as in third-party initiated login (OpenID
// Connect Core 1.0, section 4). https://openid.net/specs/openid-connect-core-1_0.html#ThirdPartyInitiatedLogin
const AGENT_LINK = { iss: ISSUER, target_link_uri: `${APP_BASE_URL}/` };

let privateKey: CryptoKey;
// The ID token that the token endpoint of the tenant gives next.
let nextIdToken = '';

const server = setupServer(
  http.get(`${ISSUER}.well-known/openid-configuration`, () =>
    HttpResponse.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}authorize`,
      token_endpoint: `${ISSUER}oauth/token`,
    })
  ),
  http.post(`${ISSUER}oauth/token`, () =>
    HttpResponse.json({
      id_token: nextIdToken,
      access_token: 'access-token-of-the-join',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid profile',
    })
  )
);

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'bypass' });
  ({ privateKey } = await generateKeyPair('RS256'));
});

afterAll(() => server.close());

// An ID token as the tenant signs it.
function idToken(sub: string, claims: Record<string, unknown> = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(privateKey);
}

// An agent's browser that joined and whose user has not signed in.
const guestIdToken = () => idToken(GUEST_SUB, { sub_profile: GUEST_SUB_PROFILE, act: ACT });
// An agent's browser whose user has signed in, for the same Poppy Session.
const agentIdToken = () => idToken(AGENT_USER_SUB, { act: ACT });
// A person who logs in on their own.
const personIdToken = () => idToken('auth0|person');

// Starts the app on a free port of 127.0.0.1 and returns a supertest client for it. The server is closed when the test
// ends, so call this from inside a test. supertest on its own listens on every address, and then another program that
// listens on 127.0.0.1 alone, on the same port, can get the request in place of the app.
async function serve(app: Express) {
  const started = createServer(app);
  await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));

  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        started.close(() => resolve());
        started.closeAllConnections();
      })
  );

  return request(started);
}

type Site = Awaited<ReturnType<typeof serve>>;

// A new app for every test, so that no test starts with the carts of another. `config` is the parsed poppy.json,
// so that no file is read.
function start() {
  return serve(
    createApp({
      domain: 'tenant.auth0.local',
      clientId: CLIENT_ID,
      clientSecret: 'shh',
      appBaseUrl: APP_BASE_URL,
      sessionSecret: 'a-session-secret-of-at-least-32-characters-long',
      poppy: {
        // The shape that `auth0 poppy config` writes.
        config: {
          protocol_version: '1.0',
          organization: { name: 'Zepto', domain: 'zepto.example' },
          auth: {
            issuer: ISSUER,
            scopes: { 'poppy:browser-sign-in': 'poppy:browser-sign-in' },
            scope_hints: { 'poppy:browser-sign-in': { changes: 'none', personal_data: false } },
          },
          apis: [],
          // The example applies no scopes, so its file says `unscoped: true`.
          web: { browser_session_endpoint: `${ISSUER}poppy/${CLIENT_ID}/browser-session`, unscoped: true },
        },
      },
    })
  );
}

// The cookies that a browser holds, by name. It ignores the attributes of a cookie. A cookie that the server sets to an
// empty value is a cookie that the server removes.
function cookieJar() {
  const cookies = new Map<string, string>();

  return {
    take(res: request.Response) {
      for (const line of res.get('Set-Cookie') ?? []) {
        const [pair = ''] = line.split(';');
        const equals = pair.indexOf('=');
        const name = pair.slice(0, equals);
        const value = pair.slice(equals + 1);

        if (value === '') {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      }
    },
    header() {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    },
  };
}

type Jar = ReturnType<typeof cookieJar>;

// A browser joins, or logs in: the login route of the app, then the callback route. The tenant answers the callback
// with `token`. The jar carries the cookies from one request to the next.
async function join(site: Site, jar: Jar, token: Promise<string>, link: Record<string, string> = AGENT_LINK) {
  const login = await site.get('/auth/login').query(link).set('Cookie', jar.header());
  expect(login.status).toBe(302);
  jar.take(login);

  nextIdToken = await token;
  const callback = await site.get('/auth/callback').query({ code: 'abc' }).set('Cookie', jar.header());
  expect(callback.status).toBe(302);
  jar.take(callback);

  return callback;
}

describe('example-express-web-poppy', () => {
  test('serves the discovery files without cookies', async () => {
    const site = await start();

    const poppy = await site.get('/.well-known/poppy.json');
    const resource = await site.get('/.well-known/oauth-protected-resource');

    for (const res of [poppy, resource]) {
      expect(res.status).toBe(200);
      expect(res.get('Cache-Control')).toBe('public, max-age=300');
      expect(res.get('Set-Cookie')).toBeUndefined();
    }
    expect(poppy.body).toMatchObject({
      protocol_version: '1.0',
      organization: { name: 'Zepto', domain: 'zepto.example' },
      auth: { issuer: ISSUER },
    });
    expect(resource.body).toMatchObject({ resource: APP_BASE_URL, authorization_servers: [ISSUER] });
  });

  test('tells a shared cache to keep no answer for one visitor, and the discovery files stay public', async () => {
    const site = await start();
    const jar = cookieJar();
    await join(site, jar, guestIdToken());

    for (const path of ['/', '/api/visitor', '/api/cart', '/orders']) {
      const res = await site.get(path).set('Cookie', jar.header());
      expect(res.get('Cache-Control'), path).toBe('no-store');
    }
    const login = await site.get('/auth/login').query(AGENT_LINK);
    expect(login.get('Cache-Control')).toBe('no-store');

    const discovery = await site.get('/.well-known/poppy.json');
    expect(discovery.get('Cache-Control')).toBe('public, max-age=300');
  });

  test('keeps the cart of a guest when the agent signs in with the same act', async () => {
    const site = await start();
    const jar = cookieJar();

    await join(site, jar, guestIdToken());
    const guest = await site.get('/api/visitor').set('Cookie', jar.header());
    expect(guest.body).toEqual({ kind: 'guest', state: 'guest' });

    const added = await site.post('/api/cart/items').set('Cookie', jar.header()).send({ sku: 'tea' });
    expect(added.status).toBe(201);
    expect(added.body).toEqual({ items: ['tea'] });

    // The user signs in, and the agent joins the same Poppy Session again, with the same `act`, so the key is the same.
    await join(site, jar, agentIdToken());

    const cart = await site.get('/api/cart').set('Cookie', jar.header());
    const signedIn = await site.get('/api/visitor').set('Cookie', jar.header());
    expect(cart.status).toBe(200);
    expect(cart.body).toEqual({ items: ['tea'] });
    expect(signedIn.body).toEqual({ kind: 'user', state: 'signed_in' });
  });

  test('refuses a guest at the orders page and does not send it to the login page', async () => {
    const site = await start();
    const jar = cookieJar();
    await join(site, jar, guestIdToken());
    // Nobody is sent to the login page by this test unless the browser holds the guest, so check that it does.
    expect((await site.get('/api/visitor').set('Cookie', jar.header())).body).toEqual({
      kind: 'guest',
      state: 'guest',
    });

    const res = await site.get('/orders').set('Cookie', jar.header());

    // The login cannot succeed while a guest is in the browser, so a redirect would only send the guest to Auth0 and back
    // to a 403.
    expect(res.status).toBe(403);
    expect(res.get('Location')).toBeUndefined();

    // Nobody (a visitor with no login) is sent to the login page.
    const nobody = await site.get('/orders');
    expect(nobody.status).toBe(302);
    expect(nobody.get('Location')).toBe('/auth/login?returnTo=%2Forders');
  });

  // A login link with an `iss` that is not the issuer says that it comes from another issuer, so the route refuses it
  // with a 400: no login starts, and no cookie is set. A link with no `iss` is a normal login: the target is not used, so
  // the browser lands on the home page, and `target_link_uri` never goes on to Auth0.
  test('refuses a login link from another issuer with a 400, and starts no login', async () => {
    const site = await start();
    const jar = cookieJar();
    const link = { iss: 'https://other.auth0.local/', target_link_uri: `${APP_BASE_URL}/orders` };

    const refused = await site.get('/auth/login').query(link);

    expect(refused.status).toBe(400);
    expect(refused.get('Location')).toBeUndefined();
    expect(refused.get('Set-Cookie')).toBeUndefined();

    const plain = await site.get('/auth/login').query({ target_link_uri: link.target_link_uri });

    expect(plain.status).toBe(302);
    expect(new URL(plain.get('Location') ?? '').searchParams.has('target_link_uri')).toBe(false);

    const callback = await join(site, jar, agentIdToken(), { target_link_uri: link.target_link_uri });

    expect(callback.get('Location')).toBe(`${APP_BASE_URL}/`);
  });

  test('refuses the login of a person while a guest is in the browser, and the guest stays', async () => {
    const site = await start();
    const jar = cookieJar();
    await join(site, jar, guestIdToken());
    const before = (await site.get('/api/visitor').set('Cookie', jar.header())).body;
    expect(before).toEqual({ kind: 'guest', state: 'guest' });

    const login = await site.get('/auth/login').set('Cookie', jar.header());
    expect(login.status).toBe(302);
    jar.take(login);
    nextIdToken = await personIdToken();
    const callback = await site.get('/auth/callback').query({ code: 'abc' }).set('Cookie', jar.header());

    expect(callback.status).toBe(403);
    expect((await site.get('/api/visitor').set('Cookie', jar.header())).body).toEqual(before);
  });

  test('a guest join ends the login of a person in the same browser', async () => {
    const site = await start();
    const jar = cookieJar();
    await join(site, jar, personIdToken(), {});
    expect((await site.get('/api/visitor').set('Cookie', jar.header())).body).toEqual({ kind: 'user' });

    await join(site, jar, guestIdToken());

    expect((await site.get('/api/visitor').set('Cookie', jar.header())).body).toEqual({ kind: 'guest', state: 'guest' });
    expect((await site.get('/orders').set('Cookie', jar.header())).status).toBe(403);
  });

  test('shows the orders to an agent whose user has signed in', async () => {
    const site = await start();
    const jar = cookieJar();
    await join(site, jar, agentIdToken());

    const res = await site.get('/orders').set('Cookie', jar.header());

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
  });

  test('keeps the cart of a person who logs in without an agent under the account', async () => {
    const site = await start();
    const jar = cookieJar();
    // A person's login link has no `iss` and no `target_link_uri`.
    await join(site, jar, personIdToken(), {});

    const visitor = await site.get('/api/visitor').set('Cookie', jar.header());
    const added = await site.post('/api/cart/items').set('Cookie', jar.header()).send({ sku: 'tea' });
    const cart = await site.get('/api/cart').set('Cookie', jar.header());
    const orders = await site.get('/orders').set('Cookie', jar.header());

    // No `state`: the person has no Poppy Session.
    expect(visitor.body).toEqual({ kind: 'user' });
    expect(added.status).toBe(201);
    expect(cart.body).toEqual({ items: ['tea'] });
    expect(orders.status).toBe(200);
  });

  test('gives a visitor with no key no cart, and refuses an item without a sku', async () => {
    const site = await start();

    // Nobody has joined, so there is no key for a cart.
    const empty = await site.get('/api/cart');
    const refused = await site.post('/api/cart/items').send({ sku: 'tea' });
    expect(empty.status).toBe(401);
    expect(empty.body).toEqual({ error: 'no_cart' });
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual({ error: 'no_cart' });

    const jar = cookieJar();
    await join(site, jar, guestIdToken());
    for (const body of [{}, { sku: '' }, { sku: 7 }, { sku: ['tea'] }]) {
      const res = await site.post('/api/cart/items').set('Cookie', jar.header()).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_sku' });
    }
    expect((await site.get('/api/cart').set('Cookie', jar.header())).body).toEqual({ items: [] });
  });

  test('describes the visitor on the home page', async () => {
    const site = await start();
    const jar = cookieJar();

    const nobody = await site.get('/');
    await join(site, jar, guestIdToken());
    await site.post('/api/cart/items').set('Cookie', jar.header()).send({ sku: 'tea' });
    const guest = await site.get('/').set('Cookie', jar.header());
    await join(site, jar, agentIdToken());
    const signedIn = await site.get('/').set('Cookie', jar.header());

    expect(nobody.text).toContain('Nobody has joined or signed in from this browser.');
    // Nobody has no cart, so there is nothing to add to.
    expect(nobody.text).toContain('Log in to start a cart.');
    expect(nobody.text).not.toContain('data-sku');
    expect(guest.text).toContain('An agent is browsing for a user who has not signed in.');
    expect(guest.text).toContain('<h2>Cart (1)</h2><ul><li>tea</li></ul>');
    expect(guest.text).toContain('data-sku="tea"');
    expect(signedIn.text).toContain('A signed-in user is browsing.');
    expect(signedIn.text).toContain('<h2>Cart (1)</h2><ul><li>tea</li></ul>');
    for (const page of [nobody, guest, signedIn]) {
      expect(page.status).toBe(200);
      expect(page.type).toBe('text/html');
    }
  });

  test('offers the login button to nobody with a session, and the logout button to a visitor with a session', async () => {
    const site = await start();
    const jar = cookieJar();

    const nobody = await site.get('/');
    await join(site, jar, guestIdToken());
    const guest = await site.get('/').set('Cookie', jar.header());
    // A person who logs in on their own, in another browser. A browser that holds a guest keeps reporting the guest first.
    const personJar = cookieJar();
    await join(site, personJar, personIdToken(), {});
    const person = await site.get('/').set('Cookie', personJar.header());

    expect(nobody.text).toContain('href="/auth/login"');
    expect(nobody.text).not.toContain('href="/auth/logout"');
    // A guest cannot sign in on the website, so it is not offered the login.
    expect(guest.text).not.toContain('href="/auth/login"');
    expect(guest.text).toContain('href="/auth/logout"');
    expect(person.text).not.toContain('href="/auth/login"');
    expect(person.text).toContain('href="/auth/logout"');
  });

  test('shows the information of the current session', async () => {
    const site = await start();
    const jar = cookieJar();

    const nobody = await site.get('/');
    await join(site, jar, guestIdToken());
    const guest = await site.get('/').set('Cookie', jar.header());
    await join(site, jar, agentIdToken());
    const agentUser = await site.get('/').set('Cookie', jar.header());
    // A person who logs in on their own, in another browser.
    const personJar = cookieJar();
    await join(site, personJar, idToken('auth0|person', { name: 'Pat', email: 'pat@example.com' }), {});
    const person = await site.get('/').set('Cookie', personJar.header());

    expect(nobody.text).toContain('<dt>Visitor</dt><dd>none</dd>');
    expect(nobody.text).not.toContain('Poppy Session ID');

    expect(guest.text).toContain('<dt>Visitor</dt><dd>guest</dd>');
    expect(guest.text).toContain('<dt>Poppy Session state</dt><dd>guest</dd>');
    expect(guest.text).toContain(`<dt>Poppy Session ID</dt><dd>${SESSION_ID}</dd>`);
    expect(guest.text).toContain(`<dt>Poppy user ID</dt><dd>${USER_ID}</dd>`);
    expect(guest.text).toContain(`<dt>Agent</dt><dd>${AGENT_URL}</dd>`);
    expect(guest.text).not.toContain('Subject (sub)');

    expect(agentUser.text).toContain('<dt>Visitor</dt><dd>user</dd>');
    expect(agentUser.text).toContain(`<dt>Subject (sub)</dt><dd>${AGENT_USER_SUB}</dd>`);
    expect(agentUser.text).toContain('<dt>Poppy Session state</dt><dd>signed_in</dd>');

    expect(person.text).toContain('<dt>Subject (sub)</dt><dd>auth0|person</dd>');
    expect(person.text).toContain('<dt>Name</dt><dd>Pat</dd>');
    expect(person.text).toContain('<dt>Email</dt><dd>pat@example.com</dd>');
    expect(person.text).not.toContain('Poppy Session ID');
  });

  test('escapes the values of the session and the items of the cart on the home page', async () => {
    const site = await start();
    const jar = cookieJar();
    const name = '<script>alert("x")</script>';
    const sku = '<img src=x onerror=alert(1)>';

    await join(site, jar, idToken('auth0|person', { name }), {});
    await site.post('/api/cart/items').set('Cookie', jar.header()).send({ sku });
    const res = await site.get('/').set('Cookie', jar.header());

    // The page has a script of its own (the add buttons), so look for what the visitor chose, not for any tag.
    expect(res.text).not.toContain('<script>alert');
    // The only script tag is the one of the page (the add buttons).
    expect(res.text.match(/<script/g)).toHaveLength(1);
    expect(res.text).toContain('&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;');
    expect(res.text).not.toContain('<img');
    expect(res.text).toContain('&#60;img src=x onerror=alert(1)&#62;');
  });
});
