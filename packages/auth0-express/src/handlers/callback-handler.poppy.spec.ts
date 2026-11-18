import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
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
  return setCookieLines(res).filter((line) => /^(__a0_session|__a0_poppy|__Host-a0_poppy)/.test(line));
}

/** A callback that failed leaves nothing behind: no cookie is set, and the visitor is still `none`. */
async function expectNothingKept(agent: Agent, jar: CookieJar, { callback }: Joined) {
  expect(keptCookies(callback)).toEqual([]);

  const visitor = await agent.get('/visitor').set('Cookie', jar.header());
  expect(visitor.body).toEqual({ kind: 'none' });
}

// Express reads NODE_ENV when it builds the app, so each test builds its app inside withNodeEnv().
describe.each(['production', 'development'] as const)('callback errors on a Poppy app, NODE_ENV=%s', (env) => {
  test('a Poppy Session that is not well formed gets 403, and the page shows no claim', async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();

      const joined = await join(agent, jar, tenant, agentIdToken('auth0|ana', { act: { ...act, poppy_sid: 42 } }));

      expect(joined.callback.status).toBe(403);
      expect(joined.callback.text).toContain(
        errorPage(
          env,
          'Forbidden',
          'The ID token holds a Poppy Session that is not well formed, so it is neither a signed-in agent nor a user.'
        )
      );
      // The reason names the claim, and it is for logs only.
      expect(joined.callback.text).not.toContain('act.poppy_sid');
      await expectNothingKept(agent, jar, joined);
    });
  });

  // A PoppyError is a refusal because of Poppy, so it is a 403. The SDK gives each code a fixed text without a value.
  test('a guest marker without a Poppy Session gets 403', async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();
      const markerOnly = generateToken(POPPY_DOMAIN, GUEST_SUB, POPPY_CLIENT_ID, undefined, undefined, undefined, {
        sub_profile: GUEST_SUB_PROFILE,
      });

      const joined = await join(agent, jar, tenant, markerOnly);

      expect(joined.callback.status).toBe(403);
      expect(joined.callback.text).toContain(
        errorPage(
          env,
          'Forbidden',
          'The ID token looks like the login of a Poppy guest but is not a valid one, so it is neither a guest nor a user.'
        )
      );
      expect(joined.callback.text).not.toContain(GUEST_SUB);
      expect(joined.callback.text).not.toContain('act.poppy_sid');
      await expectNothingKept(agent, jar, joined);
    });
  });

  test("a person's login over a guest gets 403, and the guest stays", async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();
      const first = await join(agent, jar, tenant, guestIdToken());
      expect(first.callback.status).toBe(302);

      const second = await join(agent, jar, tenant, humanIdToken('auth0|ana'));

      expect(second.callback.status).toBe(403);
      expect(second.callback.text).toContain(
        errorPage(
          env,
          'Forbidden',
          // The page of Express escapes the apostrophe, so the text starts after it.
          's guest is in this browser, so only a signed-in agent, a new guest join, or the same guest renewing an expired access token can replace it. Log out to sign in as a person.'
        )
      );
      expect(keptCookies(second.callback)).toEqual([]);

      const visitor = await agent.get('/visitor').set('Cookie', jar.header());
      expect(visitor.body).toMatchObject({ kind: 'guest', poppy: { state: 'guest' } });
    });
  });

  test('a Poppy Session that is born expired gets 403', async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();
      const now = Math.floor(Date.now() / 1000);

      const joined = await join(agent, jar, tenant, guestIdToken({}, now + 20));

      expect(joined.callback.status).toBe(403);
      expect(joined.callback.text).toContain(
        errorPage(env, 'Forbidden', 'The session of this login has already ended.')
      );
      expect(joined.callback.text).not.toContain('refusing');
      await expectNothingKept(agent, jar, joined);
    });
  });

  test('a login whose session_expiry has already passed gets 403, and no WWW-Authenticate is needed', async () => {
    await withNodeEnv(env, async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();
      const now = Math.floor(Date.now() / 1000);

      const joined = await join(agent, jar, tenant, humanIdToken('auth0|person', { session_expiry: now }));

      expect(joined.callback.status).toBe(403);
      expect(joined.callback.text).toContain(
        errorPage(env, 'Forbidden', 'The session of this login has already ended.')
      );
      expect(joined.callback.text).not.toContain('refusing');
      await expectNothingKept(agent, jar, joined);
    });
  });

  test('the error that reaches the handler of the app has the code of the refusal, and no cause on the page', async () => {
    await withNodeEnv(env, async () => {
      const app = poppyApp();
      // The handler that EXAMPLES.md shows: it tells the refusals apart by `error.code`, with no `instanceof`.
      // Express treats a function with four parameters as an error handler, so `next` has to be there.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      app.use((error: Error & { status?: number; code?: string }, _req: Request, res: Response, next: NextFunction) => {
        res.status(error.status ?? 500).json({ code: error.code ?? null, hasCause: error.cause !== undefined });
      });
      const agent = await serve(app);
      const jar = cookieJar();
      await join(agent, jar, tenant, guestIdToken());

      const person = await join(agent, jar, tenant, humanIdToken('auth0|ana'));
      expect(person.callback.status).toBe(403);
      expect(person.callback.body).toEqual({ code: 'poppy_sign_in_required', hasCause: true });

      const invalidGuest = await join(
        agent,
        cookieJar(),
        tenant,
        guestIdToken({ sub_profile: 'something else' })
      );
      expect(invalidGuest.callback.body).toEqual({ code: 'invalid_poppy_guest', hasCause: true });

      const invalidAgent = await join(
        agent,
        cookieJar(),
        tenant,
        agentIdToken('auth0|ana', { act: { ...act, poppy_sid: 42 } })
      );
      expect(invalidAgent.callback.body).toEqual({ code: 'invalid_poppy_agent', hasCause: true });

      const ended = await join(
        agent,
        cookieJar(),
        tenant,
        humanIdToken('auth0|person', { session_expiry: Math.floor(Date.now() / 1000) })
      );
      expect(ended.callback.body).toEqual({ code: 'session_expired', hasCause: true });
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
