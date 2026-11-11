import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Express, Response } from 'express';
import type { SessionStore, StateData } from '@auth0/auth0-server-js';
import { SessionExpiredError, requiresAuth } from './index.js';
import type { Auth0Options, PoppyAgentContext, PoppyVisitor, RequiresAuthOptions, StoreOptions } from './index.js';
import {
  AGENT_ID,
  APP_BASE_URL,
  CIMD_URL,
  JOIN_ACCESS_TOKEN,
  SESSION_ID,
  SESSION_KEY,
  USER_ID,
  act,
  agentIdToken,
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

const ISS = poppyConfig.issuer;
const HOME = `${APP_BASE_URL}/`;
const CART = `${APP_BASE_URL}/cart`;
// What the login link of an agent carries: the issuer and the page to land on.
const AGENT_LINK = `?iss=${enc(ISS)}&target_link_uri=${enc(CART)}`;

const GUEST_COOKIE = '__a0_poppy.0';
const SESSION_COOKIE = '__a0_session.0';
const ANONYMOUS_COOKIE = '__a0_anon.0';

// The Poppy Session of a guest. A join that signs in keeps the same key, because the key comes from the agent and the
// Session, and not from the state.
const SIGNED_OUT: PoppyAgentContext = {
  kind: 'agent',
  state: 'signed_out',
  sessionId: SESSION_ID,
  userId: USER_ID,
  agent: { cimdUrl: CIMD_URL },
  key: SESSION_KEY,
};
const SIGNED_IN: PoppyAgentContext = { ...SIGNED_OUT, state: 'signed_in' };

const GUEST: PoppyVisitor = { kind: 'guest', poppy: SIGNED_OUT };
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

/** Whether the response removes the cookie: it sets an empty value that ended in 1970, as a server does. */
function removes(res: Parameters<typeof setCookieLines>[0], name: string) {
  return setCookieLines(res).some((line) => line.startsWith(`${name}=;`) && /expires=[^;]*\b1970\b/i.test(line));
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
// of the ID token, and the end of its Poppy Session.
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
        state: 'signed_out',
        sessionId: SESSION_ID,
        userId: USER_ID,
        agent: { cimdUrl: CIMD_URL },
        key: SESSION_KEY,
      },
    });
  });

  // A guest cannot sign in on the website, and the login route can bring back the same guest, so a redirect to it
  // would repeat without end. The guest is answered where it is.
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

  test('the id of the agent in act is in the visitor', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();

    await join(agent, jar, tenant, guestIdToken({ act: { ...act, poppy_agent_id: AGENT_ID } }), AGENT_LINK);

    expect(await visitorOf(agent, jar)).toEqual({
      kind: 'guest',
      poppy: { ...SIGNED_OUT, agent: { cimdUrl: CIMD_URL, poppyAgentId: AGENT_ID } },
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
  test('a signed-in join after a guest join replaces the guest with a user, and the key stays', async () => {
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
});

describe('Session changes', () => {
  test('a guest join over a signed-in agent session deletes the session, and the visitor is a guest', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, agentIdToken());
    expect(jar.names()).toEqual([SESSION_COOKIE]);

    const { callback } = await join(agent, jar, tenant, guestIdToken());

    // A rejoin without an access token ends the sign-in of a Session:
    // https://personalagentprotocol.org/docs/0.3/spec#web-browsing
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
  // back": https://personalagentprotocol.org/docs/0.3/spec#web-browsing
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

describe("A guest join keeps a person's login", () => {
  // A join without an access token should not end or change the login that the browser has, and the specification says
  // so: https://personalagentprotocol.org/docs/0.3/spec#web-browsing. The guest comes first in getVisitor(), because an
  // agent drives the browser then. The login of the person is not touched, so getUser() and requiresAuth() still see
  // the person. An app that must keep an agent's browser out of the pages of a person checks getVisitor() as well.
  test('getVisitor() says guest, while getUser() and requiresAuth() still see the person', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, humanIdToken());

    const { callback } = await join(agent, jar, tenant, guestIdToken());

    expect(removes(callback, SESSION_COOKIE)).toBe(false);
    expect(sortedNames(jar)).toEqual([GUEST_COOKIE, SESSION_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
    expect((await visit(agent, jar, '/user')).body.user.sub).toBe('auth0|person');
    expect((await visit(agent, jar, '/private')).status).toBe(200);
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
    expect(logout.headers['location']).toMatch(/^https:\/\/auth\.zepto\.example\/oidc\/logout\?/);
    expect(removes(logout, GUEST_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([]);
    expect(await visitorOf(agent, jar)).toEqual(NONE);
  });

  test('after a signed-in join, it clears the session and the visitor is none', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);

    const logout = await visit(agent, jar, '/auth/logout');
    jar.take(logout);

    expect(logout.status).toBe(302);
    expect(removes(logout, SESSION_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([]);
    expect(await visitorOf(agent, jar)).toEqual(NONE);
  });

  test('it ends the guest and the login of the person that the guest joined over', async () => {
    const agent = await serve(testApp());
    const jar = cookieJar();
    await join(agent, jar, tenant, humanIdToken());
    await join(agent, jar, tenant, guestIdToken());
    expect(sortedNames(jar)).toEqual([GUEST_COOKIE, SESSION_COOKIE]);

    const logout = await visit(agent, jar, '/auth/logout');
    jar.take(logout);

    expect(removes(logout, GUEST_COOKIE)).toBe(true);
    expect(removes(logout, SESSION_COOKIE)).toBe(true);
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
  async function anonymousBrowser() {
    const agent = await serve(testApp({ anonymousSessions: true }));
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

  test('an anonymous session makes the visitor anonymous', async () => {
    const { agent, jar } = await anonymousBrowser();

    expect(await visitorOf(agent, jar)).toEqual(ANONYMOUS);
  });

  test('a guest join keeps the anonymous cookie, and the visitor is the guest', async () => {
    const { agent, jar } = await anonymousBrowser();

    const { callback } = await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);

    expect(removes(callback, ANONYMOUS_COOKIE)).toBe(false);
    expect(sortedNames(jar)).toEqual([ANONYMOUS_COOKIE, GUEST_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(GUEST);
  });

  test('a signed-in join clears the anonymous cookie, and the visitor is a user', async () => {
    const { agent, jar } = await anonymousBrowser();

    const { callback } = await join(agent, jar, tenant, agentIdToken(), AGENT_LINK);

    expect(removes(callback, ANONYMOUS_COOKIE)).toBe(true);
    expect(jar.names()).toEqual([SESSION_COOKIE]);
    expect(await visitorOf(agent, jar)).toEqual(userVisitor('auth0|ana', SIGNED_IN));
  });

  test('when the guest ends, the anonymous visitor is back', async () => {
    const { agent, jar } = await anonymousBrowser();
    await join(agent, jar, tenant, guestIdToken(), AGENT_LINK);
    fakeDate(Date.now())(TWO_HOURS);

    const visitor = await visit(agent, jar, '/visitor');

    expect(visitor.body).toEqual(ANONYMOUS);
    expect(removes(visitor, GUEST_COOKIE)).toBe(true);
    expect(removes(visitor, ANONYMOUS_COOKIE)).toBe(false);
  });
});
