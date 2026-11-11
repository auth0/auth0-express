import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { http, HttpResponse } from 'msw';
import { withNodeEnv } from '../test-utils/env.js';
import {
  GUEST_SUB,
  GUEST_SUB_PROFILE,
  POPPY_CLIENT_ID,
  POPPY_DOMAIN,
  act,
  agentIdToken,
  cookieJar,
  guestIdToken,
  humanIdToken,
  join,
  poppyApp,
  poppyTenant,
  setCookieLines,
} from '../test-utils/poppy.js';
import type { CookieJar } from '../test-utils/poppy.js';
import { serve } from '../test-utils/serve.js';
import { generateToken } from '../test-utils/tokens.js';

const tenant = poppyTenant();

beforeAll(() => tenant.server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => tenant.server.resetHandlers());
afterAll(() => tenant.server.close());

type Agent = Awaited<ReturnType<typeof serve>>;
type Joined = Awaited<ReturnType<typeof join>>;
type Env = 'production' | 'development';

/** What Express's default error handler writes: the status text in production, `err.stack` in any other environment. */
function errorPage(env: Env, production: string, development: string) {
  return env === 'production' ? production : development;
}

/** The session and guest cookies that a response sets. */
function keptCookies(res: Joined['callback']) {
  return setCookieLines(res).filter((line) => /^__a0_(session|poppy)/.test(line));
}

/** A callback that failed leaves nothing behind: no cookie is set, and the visitor is still `none`. */
async function expectNothingKept(agent: Agent, jar: CookieJar, { callback }: Joined) {
  expect(keptCookies(callback)).toEqual([]);

  const visitor = await agent.get('/visitor').set('Cookie', jar.header());
  expect(visitor.body).toEqual({ kind: 'none' });
}

// Express reads NODE_ENV when it builds the app, so each test builds its app inside withNodeEnv().
describe.each(['production', 'development'] as const)('callback errors on a Poppy app, NODE_ENV=%s', (env) => {
  test('a Poppy Session that is not well formed gets 400', async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();

      const joined = await join(agent, jar, tenant, agentIdToken('auth0|ana', { act: { ...act, poppy_sid: 42 } }));

      expect(joined.callback.status).toBe(400);
      expect(joined.callback.text).toContain(
        errorPage(env, 'Bad Request', 'The Poppy Session of this login is not valid.')
      );
      expect(joined.callback.text).not.toContain('act.poppy_sid');
      expect(joined.callback.text).not.toContain('well-formed');
      await expectNothingKept(agent, jar, joined);
    });
  });

  test('a guest marker without a Poppy Session gets 400', async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();
      const markerOnly = generateToken(POPPY_DOMAIN, GUEST_SUB, POPPY_CLIENT_ID, undefined, undefined, undefined, {
        sub_profile: GUEST_SUB_PROFILE,
      });

      const joined = await join(agent, jar, tenant, markerOnly);

      expect(joined.callback.status).toBe(400);
      expect(joined.callback.text).toContain(
        errorPage(env, 'Bad Request', 'The Poppy Session of this login is not valid.')
      );
      expect(joined.callback.text).not.toContain('act.poppy_sid');
      expect(joined.callback.text).not.toContain('well-formed');
      await expectNothingKept(agent, jar, joined);
    });
  });

  test('a Poppy Session that is born expired gets 401', async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();
      const now = Math.floor(Date.now() / 1000);

      const joined = await join(agent, jar, tenant, guestIdToken({}, now + 20));

      expect(joined.callback.status).toBe(401);
      expect(joined.callback.text).toContain(
        errorPage(env, 'Unauthorized', 'The session of this login has already ended.')
      );
      expect(joined.callback.text).not.toContain('refusing');
      await expectNothingKept(agent, jar, joined);
    });
  });

  test('a login whose session_expiry has already passed gets 401', async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();
      const now = Math.floor(Date.now() / 1000);

      const joined = await join(agent, jar, tenant, humanIdToken('auth0|person', { session_expiry: now }));

      expect(joined.callback.status).toBe(401);
      expect(joined.callback.text).toContain(
        errorPage(env, 'Unauthorized', 'The session of this login has already ended.')
      );
      expect(joined.callback.text).not.toContain('refusing');
      await expectNothingKept(agent, jar, joined);
    });
  });

  test('the same login gets 500 without the poppy option, as before', async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp({ poppy: undefined }));
      const now = Math.floor(Date.now() / 1000);

      const { callback } = await join(
        agent,
        cookieJar(),
        tenant,
        humanIdToken('auth0|person', { session_expiry: now })
      );

      expect(callback.status).toBe(500);
      expect(callback.text).toContain(
        errorPage(env, 'Internal Server Error', 'Authentication request could not be completed.')
      );
      expect(callback.text).not.toContain('refusing');
      expect(keptCookies(callback)).toEqual([]);
    });
  });

  test('a failed token exchange stays 500 and shows nothing of the token endpoint', async () => {
    await withNodeEnv(env, async () => {
      tenant.server.use(
        http.post(`https://${POPPY_DOMAIN}/oauth/token`, () =>
          HttpResponse.json({ error: 'invalid_grant' }, { status: 400 })
        )
      );
      const agent = await serve(poppyApp());
      const jar = cookieJar();

      const joined = await join(agent, jar, tenant, guestIdToken());

      expect(joined.callback.status).toBe(500);
      expect(joined.callback.text).toContain(
        errorPage(env, 'Internal Server Error', 'Authentication request could not be completed.')
      );
      expect(joined.callback.text).not.toContain('invalid_grant');
      await expectNothingKept(agent, jar, joined);
    });
  });
});
