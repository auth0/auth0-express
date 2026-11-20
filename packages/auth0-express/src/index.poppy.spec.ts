import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import express from 'express';
import type { Express, Response } from 'express';
import type { SessionStore, StateData } from '@auth0/auth0-server-js';
import { SessionExpiredError, claimCheck, claimEquals, claimIncludes, requiresAuth } from './index.js';
import type { Auth0Options, PoppyAgentContext, PoppyVisitor, RequiresAuthOptions, StoreOptions } from './index.js';
import {
  AGENT_ID,
  APP_BASE_URL,
  CIMD_URL,
  GUEST_SUB,
  GUEST_SUB_PROFILE,
  JOIN_ACCESS_TOKEN,
  POPPY_CLIENT_ID,
  SESSION_ID,
  SESSION_KEY,
  USER_ID,
  act,
  agentIdToken,
  browserAccepts,
  clearsCookie,
  cookieJar,
  guestIdToken,
  humanIdToken,
  join,
  poppyApp,
  poppyConfig,
  poppyTenant,
  setCookieLines,
} from './test-utils/poppy.js';
import type { CookieJar } from './test-utils/poppy.js';
import { serve } from './test-utils/serve.js';

// An agent's browser joins through the real login and callback routes of an Express app. Each test then reads the
// result the way a route of the app would: getVisitor(), getUser(), requiresAuth() and getAccessToken(). The tenant is
// a mock, and its token endpoint answers with the ID token that the test set last.

const tenant = poppyTenant();

beforeAll(() => tenant.server.listen({ onUnhandledRequest: 'bypass' }));
// Only `Date` is ever faked (see "Deadlines"), and it is always given back.
afterEach(() => {
  vi.useRealTimers();
  tenant.server.resetHandlers();
});
afterAll(() => tenant.server.close());

type Agent = Awaited<ReturnType<typeof serve>>;

const enc = encodeURIComponent;

const ISS = poppyConfig.auth.issuer;
const HOME = `${APP_BASE_URL}/`;
const CART = `${APP_BASE_URL}/cart`;
// What the login link of an agent carries: the issuer and the page to land on.
const AGENT_LINK = `?iss=${enc(ISS)}&target_link_uri=${enc(CART)}`;

const GUEST_COOKIE = '__Host-a0_poppy.0';
const SESSION_COOKIE = '__a0_session.0';
const ANONYMOUS_COOKIE = '__a0_anon.0';

// The context of a guest mirrors its ID token: `sub`, `sub_profile` and the whole `act`. A guest has no scopes. A join that
// signs in has the same key when its `act.poppy_sid` and `act.poppy_user_id` are the same, because the key comes from
// those two and not from the agent or the state.
const GUEST_CONTEXT: PoppyAgentContext = {
  kind: 'agent',
  state: 'guest',
  sub: GUEST_SUB,
  sub_profile: GUEST_SUB_PROFILE,
  act,
  scopes: [],
  key: SESSION_KEY,
};
// A signed-in agent has the user as `sub`, and the scope of the access token of its join (the mock tenant gives
// `openid profile`).
const SIGNED_IN: PoppyAgentContext = {
  kind: 'agent',
  state: 'signed_in',
  sub: 'auth0|ana',
  act,
  scopes: ['openid', 'profile'],
  key: SESSION_KEY,
};

const GUEST: PoppyVisitor = { kind: 'guest', poppy: GUEST_CONTEXT };
const NONE: PoppyVisitor = { kind: 'none' };

/** The visitor after a login by `sub`. `poppy` is there when an agent made the login, and only then. */
function userVisitor(sub: string, poppy?: PoppyAgentContext) {
  return { kind: 'user', user: expect.objectContaining({ sub }), ...(poppy ? { poppy } : {}) };
}

function failed(res: Response, error: unknown) {
  res.status(500).json({ error: error instanceof Error ? error.name : 'Error' });
}

/**
 * `poppyApp()` with three more routes. `POST /anonymous` starts an anonymous session. `GET /guest-token` gives the
 * access token of the guest, and `GET /token` says whether the access token of the user is good.
 */
function testApp(extra?: Partial<Auth0Options>): Express {
  const app = poppyApp(extra);

  app.post('/anonymous', async (req, res) => {
    try {
      await req.auth0.client.anonymous.createSession();
      res.status(201).end();
    } catch (error) {
      failed(res, error);
    }
  });

  app.get('/guest-token', async (req, res) => {
    try {
      res.json({ accessToken: (await req.auth0.client.poppy.getGuestAccessToken())?.accessToken ?? null });
    } catch (error) {
      failed(res, error);
    }
  });

  app.get('/token', async (req, res) => {
    try {
      await req.auth0.client.getAccessToken();
      res.json({ ok: true });
    } catch (error) {
      res.json({ sessionExpired: error instanceof SessionExpiredError });
    }
  });

  return app;
}

/** A GET with the cookies that the browser of the test holds. The cookies in the response are not taken. */
function visit(agent: Agent, jar: CookieJar, path: string) {
  return agent.get(path).set('Cookie', jar.header());
}

/** What `GET /visitor` says. */
async function visitorOf(agent: Agent, jar: CookieJar): Promise<PoppyVisitor> {
  const res = await visit(agent, jar, '/visitor');
  expect(res.status).toBe(200);
  return res.body;
}

/**
 * Whether the response removes the cookie: it sets an empty value that has expired (`Max-Age=0` or an `Expires` in
 * 1970), and a browser accepts the header (a `__Host-` cookie is cleared only by a header with `Secure`).
 */
function removes(res: Parameters<typeof setCookieLines>[0], name: string) {
  return setCookieLines(res).some(
    (line) => line.startsWith(`${name}=;`) && clearsCookie(line) && browserAccepts(line)
  );
}

/** The names of the cookies in the jar, sorted: the order that they were set in is not what a test is about. */
function sortedNames(jar: CookieJar) {
  return [...jar.names()].sort();
}

/**
 * Fakes `Date` alone, because a faked timer would stop the server and msw. Gives back a function that sets the date to
 * a number of seconds after `from`. The `afterEach` above gives the real date back.
 */
function fakeDate(from: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  return (seconds: number) => vi.setSystemTime(from + seconds * 1000);
}

// An agent's session ends at the first of these: two hours after the join (agentSessionMaxAge, the default), the exp
// of the ID token, and the session_expiry of the ID token. The SDK does not see the end of the Poppy Session itself.
const TWO_HOURS = 7200;

describe('Guest join', () => {
  test('lands on the target of the link, and the jar holds only the guest cookie', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();

    const { login, callback } = await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    expect(login.status).toBe(302);
    expect(login.headers['location']).toMatch(/^https:\/\/auth\.zepto\.example\/authorize\?/);
    expect(callback.status).toBe(302);
    expect(callback.headers['location']).toBe(CART);
    expect(jar.names()).toEqual([GUEST_COOKIE]);
  });

  test('the visitor is a guest, with the Session of the join and its key', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();

    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    expect(await visitorOf(agent, jar)).toEqual({
      kind: 'guest',
      poppy: {
        kind: 'agent',
        state: 'guest',
        sub: GUEST_SUB,
        sub_profile: GUEST_SUB_PROFILE,
        act: { sub: CIMD_URL, poppy_sid: SESSION_ID, poppy_user_id: USER_ID },
        scopes: [],
        key: SESSION_KEY,
      },
    });
  });

  // A guest cannot sign in on the website: the login cannot succeed while a guest is in the browser, so a redirect would
  // only send the guest to Auth0 and back to the 403 of the callback. The guest is answered where it is.
  test('a guest is not a user: a page for users refuses it and never redirects it to the login', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    // Nobody gets other answers below (see the next test), so first check that this visitor is the guest.
    expect(await visitorOf(agent, jar)).toEqual(GUEST);

    const page = await visit(agent, jar, '/private').set('Accept', 'text/html');
    expect(page.status).toBe(403);
    expect(page.headers['location']).toBeUndefined();
    expect(page.type).toBe('text/plain');
    expect(page.text).toBe('A signed-in user is required.');

    const api = await visit(agent, jar, '/private').set('Accept', 'application/json');
    expect(api.status).toBe(403);
    expect(api.headers['location']).toBeUndefined();
    expect(api.body).toEqual({ error: 'forbidden', message: 'A signed-in user is required' });

    expect((await visit(agent, jar, '/user')).body).toEqual({ user: null });
  });

  test('nobody is still sent to the login by a page for users, and an API client is refused with 401', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    expect(await visitorOf(agent, jar)).toEqual(NONE);

    const page = await visit(agent, jar, '/private').set('Accept', 'text/html');
    expect(page.status).toBe(302);
    expect(page.headers['location']).toBe('/auth/login?returnTo=%2Fprivate');

    const api = await visit(agent, jar, '/private').set('Accept', 'application/json');
    expect(api.status).toBe(401);
    expect(api.body).toEqual({ error: 'unauthorized', message: 'Authentication required' });
  });

  test('in an Express sub-app, a guest is still answered with the 403 and onGuest runs', async () => {
    const onGuest = vi.fn((_req: unknown, res: Response) => {
      res.status(200).send('Ask your agent to sign in.');
    });
    const app = testApp();
    // `req.app` is the sub-app here, and the router writes `app.locals` of the main app only.
    const shop = express();
    shop.get('/orders', requiresAuth(), (_req, res) => {
      res.send('orders');
    });
    shop.get('/members', requiresAuth({ onGuest }), (_req, res) => {
      res.send('members');
    });
    app.use('/shop', shop);
    const agent = await serve(app);
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);

    const orders = await visit(agent, jar, '/shop/orders').set('Accept', 'text/html');
    expect(orders.status).toBe(403);
    expect(orders.headers['location']).toBeUndefined();

    const members = await visit(agent, jar, '/shop/members').set('Accept', 'text/html');
    expect(members.status).toBe(200);
    expect(members.text).toBe('Ask your agent to sign in.');
    expect(onGuest).toHaveBeenCalledTimes(1);
  });

  describe('requiresAuth({ onGuest })', () => {
    // `onGuest` answers for the app, or lets the route run. It runs for a guest and for nobody else.
    function guestApp(onGuest: (...args: Parameters<NonNullable<RequiresAuthOptions['onGuest']>>) => void) {
      const app = testApp();
      app.get('/members', requiresAuth({ onGuest }), (_req, res) => {
        res.send('members');
      });

      return app;
    }

    test('answers a guest instead of the 403, and the guest is not redirected', async () => {
      const onGuest = vi.fn((_req: unknown, res: Response) => {
        res.status(200).send('Ask your agent to sign in.');
      });
      const agent = await serve(guestApp(onGuest));
      const jar = cookieJar();
      await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

      const res = await visit(agent, jar, '/members').set('Accept', 'text/html');

      expect(res.status).toBe(200);
      expect(res.text).toBe('Ask your agent to sign in.');
      expect(res.headers['location']).toBeUndefined();
      expect(onGuest).toHaveBeenCalledTimes(1);
    });

    test('lets the route run when it calls next()', async () => {
      const agent = await serve(guestApp((_req, _res, next) => next()));
      const jar = cookieJar();
      await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

      const res = await visit(agent, jar, '/members');

      expect(res.status).toBe(200);
      expect(res.text).toBe('members');
    });

    test('hands an error of the handler to Express', async () => {
      const agent = await serve(
        guestApp(() => {
          throw new Error('handler failed');
        })
      );
      const jar = cookieJar();
      await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

      expect((await visit(agent, jar, '/members')).status).toBe(500);
    });

    test('is not called for nobody, who is sent to the login, or for a signed-in agent', async () => {
      const onGuest = vi.fn();
      const agent = await serve(guestApp(onGuest));

      const nobody = await visit(agent, cookieJar(), '/members').set('Accept', 'text/html');
      expect(nobody.status).toBe(302);
      expect(nobody.headers['location']).toBe('/auth/login?returnTo=%2Fmembers');

      const jar = cookieJar();
      await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);
      expect((await visit(agent, jar, '/members')).status).toBe(200);

      expect(onGuest).not.toHaveBeenCalled();
    });
  });

  test('getGuestAccessToken() gives the access token of the join', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    const res = await visit(agent, jar, '/guest-token');

    expect(res.body).toEqual({ accessToken: JOIN_ACCESS_TOKEN });
  });

  test('the whole act is in the visitor, with the id of the agent', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();

    await join(agent, jar, tenant, guestIdToken({ act: { ...act, poppy_agent_id: AGENT_ID } }), AGENT_LINK);

    expect(await visitorOf(agent, jar)).toEqual({
      kind: 'guest',
      poppy: { ...GUEST_CONTEXT, act: { ...act, poppy_agent_id: AGENT_ID } },
    });
  });

  test('a link without iss and target_link_uri, as Auth0 sends it today, lands on the home page', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();

    const { callback } = await join(agent, jar, tenant, guestIdToken());

    expect(callback.status).toBe(302);
    expect(callback.headers['location']).toBe(HOME);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
  });
});

describe('Sign-in', () => {
  test('a signed-in join with the same act replaces the guest with a user, and the key stays', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    const { callback } = await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);

    expect(callback.status).toBe(302);
    expect(callback.headers['location']).toBe(CART);
    expect(removes(callback, GUEST_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([SESSION_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|ana', SIGNED_IN));
    expect((await visit(agent, jar, '/private')).status).toBe(200);
  });

  // The key is a hash of `act.poppy_sid` and `act.poppy_user_id`. The SDK does not compare the join that signs in with the
  // guest, because Auth0 issues the Poppy Session and its members can differ. One of those two that differs gives another
  // key, so data kept under the key of the guest is not found.
  test.each([
    ['act.poppy_user_id', { ...act, poppy_user_id: 'usr_Z9wQ2e' }],
    ['act.poppy_sid', { ...act, poppy_sid: 'Zk3pL9sA_x7VbN2cQ8wTdE' }],
  ])('a signed-in join with another %s replaces the guest, and the key is another one', async (_member, otherAct) => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    expect((await visitorOf(agent, jar)).kind).toBe('guest');

    const { callback } = await join(agent, jar, tenant, agentIdToken('auth0|ana', { act: otherAct }), AGENT_LINK);

    expect(callback.status).toBe(302);
    expect(removes(callback, GUEST_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([SESSION_COOKIE]);
    const visitor = (await visitorOf(agent, jar)) as Extract<PoppyVisitor, { kind: 'user' }>;
    expect(visitor).toEqual(userVisitor('auth0|ana', expect.objectContaining({ state: 'signed_in', act: otherAct })));
    expect(visitor.poppy?.key).toEqual(expect.any(String));
    expect(visitor.poppy?.key).not.toBe(SESSION_KEY);
  });

  // The agent is not part of the key, so a join that names the agent another way (the ID of a linked Auth0 agent in
  // `act.sub`, or a `poppy_agent_id`) keeps the key of the guest, and so does the cart that is kept under it.
  test.each([
    ['act.sub', { ...act, sub: 'agt_3Lp9' }],
    ['act.poppy_agent_id', { ...act, poppy_agent_id: AGENT_ID }],
  ])('a signed-in join with another %s replaces the guest, and the key stays', async (_member, otherAct) => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    await join(agent, jar, tenant, agentIdToken('auth0|ana', { act: otherAct }), AGENT_LINK);

    const visitor = (await visitorOf(agent, jar)) as Extract<PoppyVisitor, { kind: 'user' }>;
    expect(visitor).toEqual(userVisitor('auth0|ana', expect.objectContaining({ state: 'signed_in', act: otherAct })));
    expect(visitor.poppy?.key).toBe(SESSION_KEY);
  });
});

describe('requiresAuth() with poppy', () => {
  /**
   * A browser with a person's session cookie and a guest cookie together. The SDK never writes the two, but two logins that
   * race in one browser can leave them, and the app has to answer for the guest then.
   */
  async function guestAndSession(agent: Agent) {
    const person = cookieJar();
    await join(agent, person, tenant, humanIdToken('auth0|ana'));
    const guest = cookieJar();
    await join(agent, guest, tenant, guestIdToken(), AGENT_LINK);

    const both = cookieJar();
    both.set(SESSION_COOKIE, person.get(SESSION_COOKIE) as string);
    both.set(GUEST_COOKIE, guest.get(GUEST_COOKIE) as string);
    return both;
  }

  test('with a guest and a session cookie, the guest comes first: a 403, and never a pass as the person', async () => {
    const agent = await serve(testApp());
    const both = await guestAndSession(agent);

    expect(await visitorOf(agent, both)).toEqual(GUEST);
    // The session is still there for `getUser()`, which is why a read of the user first would have let the request pass.
    expect((await visit(agent, both, '/user')).body).toEqual({ user: expect.objectContaining({ sub: 'auth0|ana' }) });

    const page = await visit(agent, both, '/private').set('Accept', 'text/html');
    expect(page.status).toBe(403);
    expect(page.headers['location']).toBeUndefined();
    const api = await visit(agent, both, '/private').set('Accept', 'application/json');
    expect(api.status).toBe(403);
    expect(api.body).toEqual({ error: 'forbidden', message: 'A signed-in user is required' });
  });

  test('with a guest and a session cookie, onGuest runs', async () => {
    const onGuest = vi.fn((_req: unknown, res: Response) => {
      res.status(200).send('Ask your agent to sign in.');
    });
    const app = testApp();
    app.get('/members', requiresAuth({ onGuest }), (_req, res) => {
      res.send('members');
    });
    const agent = await serve(app);
    const both = await guestAndSession(agent);

    const res = await visit(agent, both, '/members');

    expect(res.text).toBe('Ask your agent to sign in.');
    expect(onGuest).toHaveBeenCalledTimes(1);
  });

  // The claim checks are guards too. A guest has no user, so a claim check refuses it with 401 and never lets it pass as
  // the person whose session cookie is next to it.
  test('with a guest and a session cookie, the claim checks answer 401 as well', async () => {
    const app = testApp();
    app.get('/check', claimCheck(() => true), (_req, res) => {
      res.send('check');
    });
    app.get('/equals', claimEquals('sub', 'auth0|ana'), (_req, res) => {
      res.send('equals');
    });
    app.get('/includes', claimIncludes('sub', ['auth0|ana']), (_req, res) => {
      res.send('includes');
    });
    const agent = await serve(app);
    const both = await guestAndSession(agent);

    for (const path of ['/check', '/equals', '/includes']) {
      const res = await visit(agent, both, path);
      expect(res.status, path).toBe(401);
      expect(res.body, path).toEqual({ error: 'unauthorized', message: 'Authentication required' });
    }

    // The person alone, with the same session cookie, passes all three.
    const person = cookieJar();
    person.set(SESSION_COOKIE, both.get(SESSION_COOKIE) as string);
    for (const path of ['/check', '/equals', '/includes']) {
      expect((await visit(agent, person, path)).status, path).toBe(200);
    }
  });

  test('one request reads the session store once, for nobody and for a user alike', async () => {
    const sessions = new Map<string, StateData>();
    const store = mapSessionStore(sessions);
    const get = vi.spyOn(store, 'get');
    const agent = await serve(testApp({ sessionStore: store }));
    const jar = cookieJar();
    await join(agent, jar, tenant, humanIdToken('auth0|ana'));
    expect(sessions.size).toBe(1);

    // A session cookie whose record is gone: nobody is signed in, and the page redirects.
    const kept = new Map(sessions);
    sessions.clear();
    get.mockClear();
    const nobody = await visit(agent, jar, '/private').set('Accept', 'text/html');
    expect(nobody.status).toBe(302);
    expect(get).toHaveBeenCalledTimes(1);

    sessions.set(...([...kept][0] as [string, StateData]));
    get.mockClear();
    expect((await visit(agent, jar, '/private')).status).toBe(200);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('a failure of the session store reaches the error handler, and nobody is let through', async () => {
    const store = mapSessionStore(new Map());
    const agent = await serve(testApp({ sessionStore: store }));
    const jar = cookieJar();
    await join(agent, jar, tenant, humanIdToken('auth0|ana'));
    vi.spyOn(store, 'get').mockRejectedValue(new Error('store down'));

    const res = await visit(agent, jar, '/private');

    expect(res.status).toBe(500);
  });
});

describe('Session changes', () => {
  test('a guest join over a signed-in agent session deletes the session, and the visitor is a guest', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, agentIdToken());
    expect(jar.names()).toEqual([SESSION_COOKIE]);

    const { callback } = await join(agent, jar, tenant, guestIdToken());

    // A rejoin without an access token ends the sign-in of a Session:
    // https://personalagentprotocol.org/docs/spec#web-browsing
    expect(removes(callback, SESSION_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([GUEST_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
    expect((await visit(agent, jar, '/user')).body).toEqual({ user: null });
  });

  test('a normal login over an agent session gives a user with no agent', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, agentIdToken());

    await join(agent, jar, tenant, humanIdToken());

    expect(jar.names()).toEqual([SESSION_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|person'));
  });

  // A join with an access token signs the browser in "in place of any login it had, and an earlier login doesn't come
  // back": https://personalagentprotocol.org/docs/spec#web-browsing
  test("a signed-in join over a person's login replaces it, and the login does not come back", async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, humanIdToken());

    await join(agent, jar, tenant, agentIdToken());

    expect(jar.names()).toEqual([SESSION_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|ana', SIGNED_IN));

    fakeDate(Date.now())(TWO_HOURS);

    expect(await visitorOf(agent, jar)).toEqual(NONE);
  });

  test('nobody gives none', async () => {
    const agent = await serve(testApp());

    expect(await visitorOf(agent, cookieJar())).toEqual(NONE);
  });
});

describe("A guest join ends a person's login", () => {
  // The specification says that a join without an access token should not end or change the login of the browser
  // (https://personalagentprotocol.org/docs/spec#web-browsing). This SDK ends it on purpose, so that an agent's
  // browser never acts with an account that the agent was not approved for. The guest is then the only login, and the
  // person's session is gone with its cookie.
  test('the guest replaces the session of the person, and the cookie of the session is removed', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, humanIdToken());

    const { callback } = await join(agent, jar, tenant, guestIdToken());

    expect(removes(callback, SESSION_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([GUEST_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
    expect((await visit(agent, jar, '/user')).body).toEqual({ user: null });
    expect((await visit(agent, jar, '/private').set('Accept', 'text/html')).status).toBe(403);
  });

  test("a person's login over a guest is refused with 403, and the guest stays", async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    const { callback } = await join(agent, jar, tenant, humanIdToken());

    expect(callback.status).toBe(403);
    // The callback spends its transaction cookie first, as for any login. Nothing of the session or the guest is set.
    expect(setCookieLines(callback).filter((line) => /^(__a0_(session|anon)|__a0_poppy|__Host-a0_poppy)/.test(line))).toEqual([]);
    expect(jar.names()).toEqual([GUEST_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
  });

  test('a signed-in agent replaces the guest', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    const { callback } = await join(agent, jar, tenant, agentIdToken());

    expect(callback.status).toBe(302);
    expect(removes(callback, GUEST_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([SESSION_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|ana', SIGNED_IN));
  });
});

describe('Cookie names', () => {
  // The key of a cookie comes from the secret and the name of the cookie, and a guest and a session hold different
  // data. So a value that is set under the name of the other cookie is not read: renaming a cookie neither signs a
  // browser in nor makes it a guest.
  test('the guest cookie under the name of the session cookie signs nobody in', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    expect(jar.names()).toEqual([GUEST_COOKIE]);
    // Under its own name, the same value is the guest.
    expect(await visitorOf(agent, jar)).toEqual(GUEST);

    const renamed = cookieJar();
    renamed.set(SESSION_COOKIE, jar.get(GUEST_COOKIE) ?? '');

    expect(renamed.names()).toEqual([SESSION_COOKIE]);
    expect((await visit(agent, renamed, '/user')).body).toEqual({ user: null });
    expect(await visitorOf(agent, renamed)).toEqual(NONE);
  });

  test.each([
    ['a signed-in agent', () => agentIdToken()],
    ["a person's login", () => humanIdToken()],
  ])('the session cookie of %s under the name of the guest cookie is not a guest', async (_name, idToken) => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, idToken());
    expect(jar.names()).toEqual([SESSION_COOKIE]);
    // Under its own name, the same value is a user.
    expect((await visitorOf(agent, jar)).kind).toBe('user');

    const renamed = cookieJar();
    renamed.set(GUEST_COOKIE, jar.get(SESSION_COOKIE) ?? '');

    expect(renamed.names()).toEqual([GUEST_COOKIE]);
    expect(await visitorOf(agent, renamed)).toEqual(NONE);
  });
});

describe('Logout', () => {
  test('after a guest join, it clears the guest cookie and the visitor is none', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    const logout = await visit(agent, jar, '/auth/logout');
    jar.take(logout);

    expect(logout.status).toBe(302);
    // The OIDC logout endpoint fails for a guest, so a guest is sent to `/v2/logout`.
    const location = new URL(String(logout.headers['location']));
    expect(location.origin + location.pathname).toBe('https://auth.zepto.example/v2/logout');
    expect(location.searchParams.get('client_id')).toBe(POPPY_CLIENT_ID);
    expect(location.searchParams.get('returnTo')).toBe(APP_BASE_URL);
    expect(removes(logout, GUEST_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([]);
    expect(await visitorOf(agent, jar)).toEqual(NONE);
  });

  // The way out that the 403 names: "Log out to sign in as a person". It works only when the logout really removes the
  // guest cookie, which a browser does for a `__Host-` cookie only when the clearing header has `Secure`.
  test('after a guest logs out, a person can sign in', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    const refused = await join(agent, jar, tenant, humanIdToken('auth0|ana'));
    expect(refused.callback.status).toBe(403);

    jar.take(await visit(agent, jar, '/auth/logout'));
    expect(jar.names()).toEqual([]);
    const signedIn = await join(agent, jar, tenant, humanIdToken('auth0|ana'));

    expect(signedIn.callback.status).toBe(302);
    expect(jar.names()).toEqual([SESSION_COOKIE]);
    expect((await visitorOf(agent, jar)).kind).toBe('user');
  });

  // The guest may have ended, and Auth0 may still hold the anonymous session of the join, so a browser with no session
  // at all goes to the same endpoint as a guest.
  test('a browser with no session is sent to /v2/logout too', async () => {
    const agent = await serve(testApp());

    const logout = await visit(agent, cookieJar(), '/auth/logout');

    expect(logout.status).toBe(302);
    const location = new URL(String(logout.headers['location']));
    expect(location.origin + location.pathname).toBe('https://auth.zepto.example/v2/logout');
  });

  test('after a guest has ended, its logout goes to /v2/logout and clears the cookie', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    fakeDate(Date.now())(TWO_HOURS);

    const logout = await visit(agent, jar, '/auth/logout');

    const location = new URL(String(logout.headers['location']));
    expect(location.origin + location.pathname).toBe('https://auth.zepto.example/v2/logout');
    expect(removes(logout, GUEST_COOKIE)).toBe(true);
  });

  test('after a signed-in join, it clears the session and the visitor is none', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);

    const logout = await visit(agent, jar, '/auth/logout');
    jar.take(logout);

    expect(logout.status).toBe(302);
    // A signed-in agent has a user record, so it uses the end session endpoint of the tenant.
    expect(logout.headers['location']).toMatch(/^https:\/\/auth\.zepto\.example\/oidc\/logout\?/);
    expect(removes(logout, SESSION_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([]);
    expect(await visitorOf(agent, jar)).toEqual(NONE);
  });

  test('after a guest join over the login of a person, there is only the guest to end', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, humanIdToken());
    await join(agent, jar, tenant, guestIdToken());
    expect(jar.names()).toEqual([GUEST_COOKIE]);

    const logout = await visit(agent, jar, '/auth/logout');
    jar.take(logout);

    expect(String(logout.headers['location'])).toMatch(/^https:\/\/auth\.zepto\.example\/v2\/logout\?/);
    expect(removes(logout, GUEST_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([]);
    expect(await visitorOf(agent, jar)).toEqual(NONE);
    expect((await visit(agent, jar, '/user')).body).toEqual({ user: null });
  });
});

describe('Deadlines', () => {
  test('a guest ends at its deadline, and that response clears the guest cookie', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    const setDate = fakeDate(Date.now());

    setDate(1800);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);

    setDate(TWO_HOURS);
    const visitor = await visit(agent, jar, '/visitor');

    expect(visitor.body).toEqual(NONE);
    expect(removes(visitor, GUEST_COOKIE)).toBe(true);
  });

  test('a signed-in agent ends at its deadline, and its access token is refused', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);
    const setDate = fakeDate(Date.now());

    setDate(1800);
    expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|ana', SIGNED_IN));
    expect((await visit(agent, jar, '/token')).body).toEqual({ ok: true });

    // Both requests carry the cookie that the browser holds. The response of the first is not taken into the jar, as
    // two requests that are sent together would not. The clock stands at the deadline, where the encrypted cookie can
    // still be read and the session itself has ended: server-js reads a cookie with a clock tolerance of 15 seconds,
    // which is its own setting and not the default of jose. A cookie that is read much later is expired, and the
    // stateless store then throws JWTExpired, as it does for any session today.
    setDate(TWO_HOURS);
    const token = await visit(agent, jar, '/token');
    const visitor = await visit(agent, jar, '/visitor');

    expect(token.body).toEqual({ sessionExpired: true });
    expect(visitor.body).toEqual(NONE);
    expect(removes(visitor, SESSION_COOKIE)).toBe(true);
  });

  // The ID token of the tests lives for two hours, so its exp and the two hours of agentSessionMaxAge end the session
  // at the same time. The next two tests use a token that lives for a day: only agentSessionMaxAge can end their
  // session.
  const inADay = () => Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  test('a guest whose ID token lives longer still ends after two hours', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken({}, inADay()), AGENT_LINK);
    const setDate = fakeDate(Date.now());

    setDate(TWO_HOURS - 600);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);

    setDate(TWO_HOURS);
    const visitor = await visit(agent, jar, '/visitor');

    expect(visitor.body).toEqual(NONE);
    expect(removes(visitor, GUEST_COOKIE)).toBe(true);
  });

  test('a signed-in agent whose ID token lives longer still ends after two hours', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, agentIdToken('auth0|ana', {}, inADay()), AGENT_LINK);
    const setDate = fakeDate(Date.now());

    setDate(TWO_HOURS - 600);
    expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|ana', SIGNED_IN));

    setDate(TWO_HOURS);
    const token = await visit(agent, jar, '/token');
    const visitor = await visit(agent, jar, '/visitor');

    expect(token.body).toEqual({ sessionExpired: true });
    expect(visitor.body).toEqual(NONE);
  });

  test('the access token of a guest ends first, and the guest goes on', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    const setDate = fakeDate(Date.now());

    // The token endpoint of the tests gives a token for an hour.
    setDate(3700);

    expect((await visit(agent, jar, '/guest-token')).body).toEqual({ accessToken: null });
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
  });
});

describe('Renewal of a guest', () => {
  // The token endpoint of the tests gives a token for an hour. The guest lasts two hours.
  test('the same guest renews its expired access token with a silent login, and keeps its deadline', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    const setDate = fakeDate(Date.now());

    setDate(3700);
    expect((await visit(agent, jar, '/guest-token')).body).toEqual({ accessToken: null });
    expect(await visitorOf(agent, jar)).toEqual(GUEST);

    // The silent login is the login route with `prompt=none`. Auth0 gives the same guest back.
    const renewed = await join(agent, jar, tenant, guestIdToken(), '?prompt=none');

    expect(renewed.login.headers['location']).toContain('prompt=none');
    expect(renewed.callback.status).toBe(302);
    expect(jar.names()).toEqual([GUEST_COOKIE]);
    expect((await visit(agent, jar, '/guest-token')).body).toEqual({ accessToken: JOIN_ACCESS_TOKEN });
    expect(await visitorOf(agent, jar)).toEqual(GUEST);

    // The renewal did not move the end of the guest.
    setDate(TWO_HOURS);
    expect(await visitorOf(agent, jar)).toEqual(NONE);
  });

  // The login route sends `prompt=none` on to Auth0, and the SDK remembers in the transaction that the login was silent.
  test('the same guest refreshes its access token with a silent login while the token is still good, and keeps its deadline', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    const setDate = fakeDate(Date.now());
    setDate(1800);

    const refreshed = await join(agent, jar, tenant, guestIdToken(), '?prompt=none');

    expect(refreshed.callback.status).toBe(302);
    expect(jar.names()).toEqual([GUEST_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
    // The new token lasts an hour from now, so it is still good after the first one would have ended.
    setDate(3700);
    expect((await visit(agent, jar, '/guest-token')).body).toEqual({ accessToken: JOIN_ACCESS_TOKEN });
    // The refresh did not move the end of the guest.
    setDate(TWO_HOURS);
    expect(await visitorOf(agent, jar)).toEqual(NONE);
  });

  test.each(['', '?prompt=login'])(
    'the same guest is refused from a login that is not silent (%j) while its access token is still good',
    async (query) => {
      const agent = await serve(testApp());
      const jar = cookieJar();
      await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
      fakeDate(Date.now())(1800);

      const again = await join(agent, jar, tenant, guestIdToken(), query);

      expect(again.callback.status).toBe(403);
      expect(again.callback.text).toContain('Log out to sign in as a person');
      expect(await visitorOf(agent, jar)).toEqual(GUEST);
    }
  );

  test("a person's silent login is refused while the token of the guest is still good", async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    fakeDate(Date.now())(1800);

    const person = await join(agent, jar, tenant, humanIdToken('auth0|ana'), '?prompt=none');

    expect(person.callback.status).toBe(403);
    expect(person.callback.text).toContain('Log out to sign in as a person');
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
  });

  // The guest is renewed by any login once its token has expired, not only by a silent one.
  test('the same guest renews its expired access token with a login that is not silent, and keeps its deadline', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    const setDate = fakeDate(Date.now());
    setDate(3700);

    const renewed = await join(agent, jar, tenant, guestIdToken());

    expect(renewed.login.headers['location']).not.toContain('prompt=none');
    expect(renewed.callback.status).toBe(302);
    expect((await visit(agent, jar, '/guest-token')).body).toEqual({ accessToken: JOIN_ACCESS_TOKEN });
    setDate(TWO_HOURS);
    expect(await visitorOf(agent, jar)).toEqual(NONE);
  });

  test("a person's login is still refused after the token of the guest has expired", async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    fakeDate(Date.now())(3700);

    const person = await join(agent, jar, tenant, humanIdToken('auth0|ana'));

    expect(person.callback.status).toBe(403);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
  });
});

/** A `sessionStore` that keeps the sessions in a `Map`, as a server-side store such as Redis keeps them in its own. */
function mapSessionStore(sessions: Map<string, StateData>): SessionStore<StoreOptions> {
  return {
    async get(id) {
      return sessions.get(id);
    },
    async set(id, data) {
      sessions.set(id, data);
    },
    async delete(id) {
      sessions.delete(id);
    },
    async deleteByLogoutToken() {
      // Back-channel logout is not what these tests are about.
    },
  };
}

interface StoreRow {
  name: string;
  /** Whether the row has a `sessionStore`, which is a `Map`. */
  stateful: boolean;
  /** Whether the row has `legacyCompatibility`. */
  legacy: boolean;
}

const STORE_ROWS: StoreRow[] = [
  { name: "today's default", stateful: false, legacy: false },
  { name: 'a Map-backed sessionStore', stateful: true, legacy: false },
  { name: 'legacyCompatibility', stateful: false, legacy: true },
  { name: 'legacyCompatibility and a Map-backed sessionStore', stateful: true, legacy: true },
];

describe('Stores', () => {
  describe.each(STORE_ROWS)('$name', ({ stateful, legacy }) => {
    // A stateful store keeps the id of the session in a cookie that is named for the identifier. A stateless store
    // keeps the whole session in chunks, and the first one is `.0`.
    const sessionCookie = stateful ? '__a0_session' : SESSION_COOKIE;
    // How many sessions the `Map` holds when `count` exist. A row without a `sessionStore` never writes to it.
    const held = (count: number) => (stateful ? count : 0);

    function build() {
      const sessions = new Map<string, StateData>();
      const extra: Partial<Auth0Options> = {
        ...(stateful ? { sessionStore: mapSessionStore(sessions) } : {}),
        // 259200 is the default of three days. With no value set, the legacy stores warn about it.
        ...(legacy ? { legacyCompatibility: {}, sessionConfiguration: { absoluteDuration: 259200 } } : {}),
      };

      return { app: testApp(extra), sessions };
    }

    test('a guest join gives a guest', async () => {
      const { app, sessions } = build();
      const agent = await serve(app);
      const jar = cookieJar();

      await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

      expect(await visitorOf(agent, jar)).toEqual(GUEST);
      expect(jar.names()).toEqual([GUEST_COOKIE]);
      expect(sessions.size).toBe(0);
    });

    test('a signed-in join gives a user with the agent', async () => {
      const { app, sessions } = build();
      const agent = await serve(app);
      const jar = cookieJar();

      await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);

      expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|ana', SIGNED_IN));
      expect(jar.names()).toEqual([sessionCookie]);
      expect(sessions.size).toBe(held(1));
    });

    test('a guest join after a signed-in join gives a guest, and the session is gone', async () => {
      const { app, sessions } = build();
      const agent = await serve(app);
      const jar = cookieJar();
      await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);
      expect(sessions.size).toBe(held(1));

      await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

      expect(await visitorOf(agent, jar)).toEqual(GUEST);
      expect(jar.names()).toEqual([GUEST_COOKIE]);
      expect(sessions.size).toBe(0);
    });

    test('a normal login gives a user with no agent', async () => {
      const { app, sessions } = build();
      const agent = await serve(app);
      const jar = cookieJar();

      await join(agent, jar, tenant, humanIdToken());

      expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|person'));
      expect(jar.names()).toEqual([sessionCookie]);
      expect(sessions.size).toBe(held(1));
    });

    test('a normal login over an agent session gives a user with no agent, and the old session is gone', async () => {
      const { app, sessions } = build();
      const agent = await serve(app);
      const jar = cookieJar();
      await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);

      await join(agent, jar, tenant, humanIdToken());

      expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|person'));
      expect(jar.names()).toEqual([sessionCookie]);
      expect(sessions.size).toBe(held(1));
    });
  });
});

describe('Anonymous sessions', () => {
  /** A browser that has started an anonymous session. */
  async function anonymousBrowser(anonymousSessions: Auth0Options['anonymousSessions'] = true) {
    const agent = await serve(testApp({ anonymousSessions }));
    const jar = cookieJar();

    const created = await agent.post('/anonymous').set('Cookie', jar.header());
    jar.take(created);

    expect(created.status).toBe(201);
    expect(jar.names()).toEqual([ANONYMOUS_COOKIE]);
    return { agent, jar };
  }

  const ANONYMOUS: PoppyVisitor = {
    kind: 'anonymous',
    anonymous: expect.objectContaining({ sub: 'anon@test-session-id' }),
  };

  // With `poppy`, one read of the visitor looks at the guest, the user and the anonymous session, and a store that fails
  // is never read as empty. So a failing anonymous store turns a request that nobody signed in for into a 500, where
  // without `poppy` it is a 401 or a redirect, because there only the session store is read. The docs say so.
  test('a custom anonymous store that fails gives a 500 to a page for users, and not a 401', async () => {
    const store = {
      get: vi.fn().mockRejectedValue(new Error('anonymous store down')),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const agent = await serve(testApp({ anonymousSessions: { store } }));

    const res = await agent.get('/private').set('Accept', 'application/json');

    expect(res.status).toBe(500);
    expect(store.get).toHaveBeenCalled();
  });

  test('without poppy, a custom anonymous store that fails is not read by a page for users: it gives a 401', async () => {
    const store = {
      get: vi.fn().mockRejectedValue(new Error('anonymous store down')),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const agent = await serve(testApp({ poppy: undefined, anonymousSessions: { store } }));

    const res = await agent.get('/private').set('Accept', 'application/json');

    expect(res.status).toBe(401);
    expect(store.get).not.toHaveBeenCalled();
  });

  test('an anonymous session makes the visitor anonymous', async () => {
    const { agent, jar } = await anonymousBrowser();

    expect(await visitorOf(agent, jar)).toEqual(ANONYMOUS);
  });

  // The browser is the agent's now, and a leftover anonymous session would answer for it and would be linked to the next
  // person's account, so a guest join ends it, as a signed-in join does.
  test('a guest join clears the anonymous cookie, and the visitor is the guest', async () => {
    const { agent, jar } = await anonymousBrowser();

    const { callback } = await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    expect(removes(callback, ANONYMOUS_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([GUEST_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
  });

  test('a signed-in join clears the anonymous cookie, and the visitor is a user', async () => {
    const { agent, jar } = await anonymousBrowser();

    const { callback } = await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);

    expect(removes(callback, ANONYMOUS_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([SESSION_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|ana', SIGNED_IN));
  });

  test('when the guest ends, the anonymous visitor does not come back', async () => {
    const { agent, jar } = await anonymousBrowser();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    fakeDate(Date.now())(TWO_HOURS);

    const visitor = await visit(agent, jar, '/visitor');

    expect(visitor.body).toEqual(NONE);
    expect(removes(visitor, GUEST_COOKIE)).toBe(true);
  });

  describe('with clearOnLogin: false', () => {
    test('a guest join keeps the anonymous cookie, and the visitor is the guest', async () => {
      const { agent, jar } = await anonymousBrowser({ clearOnLogin: false });

      const { callback } = await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

      expect(removes(callback, ANONYMOUS_COOKIE)).toBe(false);
      expect(sortedNames(jar)).toEqual([GUEST_COOKIE, ANONYMOUS_COOKIE]);
      expect(await visitorOf(agent, jar)).toEqual(GUEST);
    });

    test('when the guest ends, the anonymous visitor is back', async () => {
      const { agent, jar } = await anonymousBrowser({ clearOnLogin: false });
      await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
      fakeDate(Date.now())(TWO_HOURS);

      const visitor = await visit(agent, jar, '/visitor');

      expect(visitor.body).toEqual(ANONYMOUS);
      expect(removes(visitor, GUEST_COOKIE)).toBe(true);
      expect(removes(visitor, ANONYMOUS_COOKIE)).toBe(false);
    });
  });
});
