import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { decrypt } from '../test-utils/encryption.js';
import { withNodeEnv } from '../test-utils/env.js';
import { APP_BASE_URL, POPPY_SECRET, poppyApp, poppyConfig, poppyTenant, setCookieLines } from '../test-utils/poppy.js';
import { serve } from '../test-utils/serve.js';

// With the poppy option, the login route is also where an agent's browser arrives, with `iss` and `target_link_uri`
// (OpenID Connect Core 1.0, section 4: https://openid.net/specs/openid-connect-core-1_0.html#ThirdPartyInitiatedLogin).
// Anyone can send a browser to the login route with any query, so the tests below send hostile ones too.

const tenant = poppyTenant();

beforeAll(() => tenant.server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => {
  tenant.parBodies.length = 0;
});
afterEach(() => tenant.server.resetHandlers());
afterAll(() => tenant.server.close());

type Agent = Awaited<ReturnType<typeof serve>>;
type Login = Awaited<ReturnType<typeof login>>;

const enc = encodeURIComponent;

const ISS = poppyConfig.issuer;
const OTHER_ISS = 'https://other-tenant.auth0.com/';
const HOME = `${APP_BASE_URL}/`;
const CART = `${APP_BASE_URL}/cart`;
const AUTHORIZE = /^https:\/\/auth\.zepto\.example\/authorize\?/;
// The names that every login sends to /authorize, with or without the poppy option.
const TODAY_KEYS = ['client_id', 'code_challenge', 'code_challenge_method', 'redirect_uri', 'response_type', 'scope'];

/** The `returnTo` that the login keeps in its transaction cookie. A redirect that sets no such cookie throws. */
async function keptReturnTo(status: number, setCookie: string[]) {
  const line = setCookie.find((cookie) => cookie.startsWith('__a0_tx='));

  if (line === undefined) {
    if (status === 302) {
      throw new Error('The login redirected without a transaction cookie.');
    }
    return undefined;
  }

  const value = line.slice('__a0_tx='.length).split(';')[0] ?? '';
  const { appState } = await decrypt<{ appState?: { returnTo?: string } }>(value, POPPY_SECRET, '__a0_tx');
  return appState?.returnTo;
}

/**
 * A GET of the login route. `keys` are the sorted names in the query of the redirect, and `returnTo` is the one that
 * the login keeps in its transaction cookie. `query` starts with `?`.
 */
async function login(agent: Agent, query = '', headers: Record<string, string> = {}) {
  const res = await agent.get(`/auth/login${query}`).set(headers);
  const setCookie = setCookieLines(res);
  const location = res.headers['location'];
  const keys = location === undefined ? [] : [...new URL(location).searchParams.keys()].sort();

  return {
    status: res.status,
    location,
    keys,
    returnTo: await keptReturnTo(res.status, setCookie),
    setCookie,
    text: res.text,
  };
}

/**
 * A GET with `node:http`, which sends the request target as it is written. supertest builds a path out of what it is
 * given, so it cannot send the absolute form (`GET http://host/path`, RFC 9112, section 3.2.2). The server is the one
 * that `serve()` started, on 127.0.0.1.
 */
function rawGet(agent: Agent, target: string, headers: Record<string, string>) {
  // A request that supertest has built and not sent shows the port of the server in its URL.
  const { port } = new URL(agent.get('/').url);

  return new Promise<{ status: number; headers: IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: target, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString() })
      );
    });
    req.on('error', reject);
    req.end();
  });
}

/** The login goes to /authorize of the tenant with the usual names only, and lands on the home page. */
function expectHome(result: Login) {
  expect(result.status).toBe(302);
  expect(result.location).toMatch(AUTHORIZE);
  expect(result.keys).toEqual(TODAY_KEYS);
  expect(result.returnTo).toBe(HOME);
}

/** The login is refused: no redirect and no cookie. */
function expectRefused(result: Login) {
  expect(result.status).toBe(400);
  expect(result.location).toBeUndefined();
  expect(result.setCookie).toEqual([]);
}

/** Runs `fn` with APP_BASE_URL and BASE_URL unset, so that only the request decides the base URL. Restores them. */
async function withoutBaseUrlEnv(fn: () => Promise<void>) {
  const saved = { APP_BASE_URL: process.env.APP_BASE_URL, BASE_URL: process.env.BASE_URL };
  delete process.env.APP_BASE_URL;
  delete process.env.BASE_URL;

  try {
    await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

// An `iss` that is not the issuer of the config, character for character.
const BAD_ISS: [string, string][] = [
  ['another tenant', `?iss=${enc(OTHER_ISS)}`],
  ['no trailing slash', `?iss=${enc('https://auth.zepto.example')}`],
  ['another case', `?iss=${enc('https://AUTH.zepto.example/')}`],
  ['empty', '?iss='],
  ['twice', `?iss=${enc(ISS)}&iss=${enc(ISS)}`],
];

// Targets that give no returnTo: another site, or this site in a form that the check does not accept.
const HOSTILE_TARGETS = [
  'https://evil.example/',
  '//evil.example/',
  'javascript:alert(1)',
  'https://zepto.example@evil.example/',
  'https:\\\\evil.example/',
  '/\\evil.example',
  'http://zepto.example/',
  'https://zepto.example:8443/',
  'https://zepto.example.evil.example/',
  '/cart',
];

describe('the login route of an app with the poppy option', () => {
  describe('normal requests', () => {
    test('with no query, it sends the usual names to /authorize and lands on the home page', async () => {
      const agent = await serve(poppyApp());

      expectHome(await login(agent));
    });

    test('iss and target_link_uri: the target is the returnTo, and neither goes to /authorize', async () => {
      const agent = await serve(poppyApp());

      const result = await login(agent, `?iss=${enc(ISS)}&target_link_uri=${enc(`${CART}?x=1`)}`);

      expect(result.status).toBe(302);
      expect(result.keys).toEqual(TODAY_KEYS);
      expect(result.returnTo).toBe(`${CART}?x=1`);
    });

    test('a target without iss is the returnTo', async () => {
      const agent = await serve(poppyApp());

      const result = await login(agent, `?target_link_uri=${enc(CART)}`);

      expect(result.status).toBe(302);
      expect(result.keys).toEqual(TODAY_KEYS);
      expect(result.returnTo).toBe(CART);
    });

    test('an iss without a target lands on the home page', async () => {
      const agent = await serve(poppyApp());

      expectHome(await login(agent, `?iss=${enc(ISS)}`));
    });

    test('other parameters still go to /authorize', async () => {
      const agent = await serve(poppyApp());

      const result = await login(agent, `?iss=${enc(ISS)}&target_link_uri=${enc(CART)}&screen_hint=signup`);

      expect(result.status).toBe(302);
      expect(result.keys).toEqual([...TODAY_KEYS, 'screen_hint'].sort());
      expect(new URL(result.location ?? '').searchParams.get('screen_hint')).toBe('signup');
      expect(result.returnTo).toBe(CART);
    });
  });

  describe('returnTo and target_link_uri', () => {
    test('a returnTo that is accepted wins over a valid target', async () => {
      const agent = await serve(poppyApp());

      const result = await login(agent, `?iss=${enc(ISS)}&target_link_uri=${enc(CART)}&returnTo=${enc('/orders')}`);

      expect(result.status).toBe(302);
      expect(result.keys).toEqual(TODAY_KEYS);
      expect(result.returnTo).toBe(`${APP_BASE_URL}/orders`);
    });

    test('a returnTo that is not accepted gives way to a valid target', async () => {
      const agent = await serve(poppyApp());

      const result = await login(agent, `?target_link_uri=${enc(CART)}&returnTo=${enc('https://evil.example/')}`);

      expect(result.status).toBe(302);
      expect(result.returnTo).toBe(CART);
    });

    test('an empty returnTo gives way to a valid target', async () => {
      const agent = await serve(poppyApp());

      const result = await login(agent, `?target_link_uri=${enc(CART)}&returnTo=`);

      expect(result.status).toBe(302);
      expect(result.returnTo).toBe(CART);
    });

    test('a returnTo alone works as it does without the option', async () => {
      const agent = await serve(poppyApp());

      const result = await login(agent, `?returnTo=${enc('/orders')}`);

      expect(result.status).toBe(302);
      expect(result.returnTo).toBe(`${APP_BASE_URL}/orders`);
    });

    test('a returnTo and a target that are both hostile leave no returnTo, as today', async () => {
      const agent = await serve(poppyApp());

      const result = await login(
        agent,
        `?target_link_uri=${enc('https://evil.example/')}&returnTo=${enc('//evil.example')}`
      );

      expect(result.status).toBe(302);
      expect(result.keys).toEqual(TODAY_KEYS);
      expect(result.returnTo).toBeUndefined();
    });
  });

  describe('hostile queries', () => {
    describe.each(['production', 'development'] as const)('an iss that is not the issuer, NODE_ENV=%s', (env) => {
      test.each(BAD_ISS)('%s gets 400, with no redirect and no cookie', async (_name, query) => {
        await withNodeEnv(env, async () => {
          const agent = await serve(poppyApp());

          const result = await login(agent, query);

          expectRefused(result);
          // Express writes the status text in production and `err.stack` in any other environment.
          expect(result.text).toContain(env === 'production' ? 'Bad Request' : 'The login request is not valid.');
          expect(result.text).not.toContain('does not match');
          expect(result.text).not.toContain('issuer');
        });
      });
    });

    test('a bad iss is refused even when a valid returnTo and a valid target come with it', async () => {
      const agent = await serve(poppyApp());
      const query = `?iss=${enc(OTHER_ISS)}&target_link_uri=${enc(CART)}&returnTo=${enc('/orders')}`;

      expectRefused(await login(agent, query));
    });

    test.each(HOSTILE_TARGETS)('the target %s gives no returnTo', async (hostile) => {
      const agent = await serve(poppyApp());

      expectHome(await login(agent, `?iss=${enc(ISS)}&target_link_uri=${enc(hostile)}`));
    });

    test('two target_link_uri give no returnTo', async () => {
      const agent = await serve(poppyApp());

      const result = await login(
        agent,
        `?iss=${enc(ISS)}&target_link_uri=${enc(`${APP_BASE_URL}/a`)}&target_link_uri=${enc(`${APP_BASE_URL}/b`)}`
      );

      expectHome(result);
    });

    test('a target is used as the URL parser writes it', async () => {
      const agent = await serve(poppyApp());

      const result = await login(agent, `?iss=${enc(ISS)}&target_link_uri=${enc('https://ZEPTO.example/Cart')}`);

      expect(result.status).toBe(302);
      expect(result.returnTo).toBe('https://zepto.example/Cart');
    });

    test('a target with two slashes in its path stays on this site and is kept as it is', async () => {
      const agent = await serve(poppyApp());
      const target = 'https://zepto.example//evil.example/x';

      const result = await login(agent, `?iss=${enc(ISS)}&target_link_uri=${enc(target)}`);

      expect(result.status).toBe(302);
      expect(result.returnTo).toBe(target);
    });

    test('a target on this site with a path of 4,000 characters is kept', async () => {
      const agent = await serve(poppyApp());
      const target = `${APP_BASE_URL}/${'a'.repeat(3999)}`;

      const result = await login(agent, `?iss=${enc(ISS)}&target_link_uri=${enc(target)}`);

      expect(result.status).toBe(302);
      expect(result.keys).toEqual(TODAY_KEYS);
      expect(result.returnTo).toBe(target);
    });

    test('names of Object.prototype in the query do not reach /authorize', async () => {
      const agent = await serve(poppyApp());

      expectHome(await login(agent, `?iss=${enc(ISS)}&__proto__=x&constructor=y&toString=z`));
    });

    test('the OAuth parameters that the SDK controls still do not reach /authorize', async () => {
      const agent = await serve(poppyApp());
      const evil = enc('https://evil.example/cb');

      const result = await login(
        agent,
        `?iss=${enc(ISS)}&state=evil&nonce=evil&audience=evil&request_uri=evil&client_id=evil&redirect_uri=${evil}`
      );

      expectHome(result);
      const params = new URL(result.location ?? '').searchParams;
      expect(params.get('client_id')).toBe('web_app_client');
      expect(params.get('redirect_uri')).toBe(`${APP_BASE_URL}/auth/callback`);
    });

    // Express 4 reads the query with the extended parser, and Express 5 with the simple one.
    // The simple parser keeps `iss[]` and `target_link_uri[]` as literal keys, and sending them on to /authorize is
    // today's behaviour for any unknown key, not a feature.
    test.each([
      ['simple', ['a[b]', 'iss[]', 'target_link_uri[]']],
      ['extended', ['a']],
    ] as const)(
      'never reads iss[] or target_link_uri[] as the issuer or the target, with the %s query parser',
      async (parser, sentOn) => {
        const app = poppyApp();
        app.set('query parser', parser);
        const agent = await serve(app);

        const result = await login(
          agent,
          `?iss[]=${enc('https://evil.example/')}&target_link_uri[]=${enc('https://evil.example/')}&a[b]=c`
        );

        // Not read as the issuer (there is no 400) and not read as the target (the landing page is the home page).
        expect(result.status).toBe(302);
        expect(result.returnTo).toBe(HOME);
        expect(result.keys).toEqual([...TODAY_KEYS, ...sentOn].sort());
      }
    );
  });

  describe('a request target in absolute form', () => {
    // A proxy can send `GET http://host/path`, and so can anyone who talks to the server directly. `req.originalUrl` is
    // then the whole URL, on another host. The login reads the query of it and nothing else, and the origin of the app
    // comes from `appBaseUrl`. So the request behaves like the same request with a path.
    test('on another host acts like a normal request, and nothing goes off this origin', async () => {
      const agent = await serve(poppyApp());
      const query = `?iss=${enc(ISS)}&target_link_uri=${enc(CART)}`;
      const normal = await login(agent, query);
      expect(normal.status).toBe(302);
      expect(normal.returnTo).toBe(CART);

      const res = await rawGet(agent, `http://evil.example/auth/login${query}`, { Host: 'evil.example' });

      const location = res.headers['location'] ?? '';
      expect(res.status).toBe(302);
      expect(location).toMatch(AUTHORIZE);
      expect(location).not.toContain('evil.example');
      const params = new URL(location).searchParams;
      expect([...params.keys()].sort()).toEqual(normal.keys);
      expect(params.get('redirect_uri')).toBe(`${APP_BASE_URL}/auth/callback`);
      expect(await keptReturnTo(res.status, setCookieLines(res))).toBe(CART);
    });
  });

  describe('the origin of a target, in each mode of appBaseUrl', () => {
    test('with a list of base URLs, it is the origin that matches the request', async () => {
      const app = poppyApp({ appBaseUrl: ['https://zepto.example', 'https://shop.zepto.example'] });
      app.set('trust proxy', true);
      const agent = await serve(app);
      const headers = { 'X-Forwarded-Host': 'shop.zepto.example', 'X-Forwarded-Proto': 'https' };

      const onShop = await login(agent, `?target_link_uri=${enc('https://shop.zepto.example/cart')}`, headers);
      expect(onShop.status).toBe(302);
      expect(onShop.returnTo).toBe('https://shop.zepto.example/cart');

      const onZepto = await login(agent, `?target_link_uri=${enc('https://zepto.example/cart')}`, headers);
      expect(onZepto.status).toBe(302);
      expect(onZepto.returnTo).toBe('https://shop.zepto.example/');
    });

    test('with no base URL, it is the origin of the request, as for a returnTo today', async () => {
      await withoutBaseUrlEnv(async () => {
        const agent = await serve(poppyApp({ appBaseUrl: undefined }));
        const headers = { Host: 'shop.example' };

        const onHost = await login(agent, `?target_link_uri=${enc('http://shop.example/cart')}`, headers);
        expect(onHost.status).toBe(302);
        expect(onHost.returnTo).toBe('http://shop.example/cart');

        const onZepto = await login(agent, `?target_link_uri=${enc('https://zepto.example/cart')}`, headers);
        expect(onZepto.status).toBe(302);
        expect(onZepto.returnTo).toBe('http://shop.example/');
      });
    });
  });

  describe('pushed authorization requests', () => {
    test('iss and target_link_uri are in neither the pushed request nor the redirect', async () => {
      const agent = await serve(poppyApp({ pushedAuthorizationRequests: true }));

      const result = await login(agent, `?iss=${enc(ISS)}&target_link_uri=${enc(CART)}`);

      expect(result.status).toBe(302);
      expect(result.keys).toEqual(['client_id', 'request_uri']);
      expect(result.returnTo).toBe(CART);

      expect(tenant.parBodies).toHaveLength(1);
      const pushed = new URLSearchParams(tenant.parBodies[0]);
      expect(pushed.has('redirect_uri')).toBe(true);
      expect(pushed.has('iss')).toBe(false);
      expect(pushed.has('target_link_uri')).toBe(false);
    });
  });

  describe('without the poppy option', () => {
    test('iss and target_link_uri go to /authorize, as before', async () => {
      const agent = await serve(poppyApp({ poppy: undefined }));

      const result = await login(agent, '?iss=x&target_link_uri=y');

      expect(result.status).toBe(302);
      const params = new URL(result.location ?? '').searchParams;
      expect(params.get('iss')).toBe('x');
      expect(params.get('target_link_uri')).toBe('y');
    });

    test('a target is not the returnTo, and a bad iss does not stop the login', async () => {
      const agent = await serve(poppyApp({ poppy: undefined }));

      const result = await login(agent, `?iss=${enc(OTHER_ISS)}&target_link_uri=${enc(CART)}`);

      expect(result.status).toBe(302);
      expect(result.keys).toEqual([...TODAY_KEYS, 'iss', 'target_link_uri'].sort());
      expect(result.returnTo).toBe(HOME);
    });
  });
});
