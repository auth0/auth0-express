import { expect, test, afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  createAuth0,
  AnonymousSessionExpiredError,
  MissingAnonymousSessionError,
} from './index.js';
import { InvalidConfigurationError } from './errors/index.js';
import { generateToken } from './test-utils/tokens.js';

const domain = 'auth0.local';
const SESSION_TOKEN = 'ANONYMOUS_SESSION_' + 'a'.repeat(64);

let anonAccessToken: string;

const server = setupServer(
  http.get(`https://${domain}/.well-known/openid-configuration`, () =>
    HttpResponse.json({
      issuer: `https://${domain}/`,
      authorization_endpoint: `https://${domain}/authorize`,
      token_endpoint: `https://${domain}/custom/token`,
      end_session_endpoint: `https://${domain}/logout`,
    })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());

beforeEach(async () => {
  anonAccessToken = await generateToken(domain, 'anon@test-session-id');
  server.use(
    http.post(`https://${domain}/anonymous/token`, () =>
      HttpResponse.json({
        access_token: anonAccessToken,
        token_type: 'N_A',
        expires_in: 7200,
        session_token: SESSION_TOKEN,
        session_expires_in: 2592000,
      })
    )
  );
});

afterEach(() => server.resetHandlers());

function createAnonApp(overrides: Partial<Parameters<typeof createAuth0>[0]> = {}) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(
    createAuth0({
      domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
      anonymousSessions: true,
      ...overrides,
    })
  );
  return app;
}

test('AnonymousSessionExpiredError is exported and is an Error subclass', () => {
  const err = new AnonymousSessionExpiredError();
  expect(err).toBeInstanceOf(Error);
  expect(err).toBeInstanceOf(AnonymousSessionExpiredError);
  expect(err.name).toBe('AnonymousSessionExpiredError');
});

test('MissingAnonymousSessionError is exported and is an Error subclass', () => {
  const err = new MissingAnonymousSessionError();
  expect(err).toBeInstanceOf(Error);
  expect(err).toBeInstanceOf(MissingAnonymousSessionError);
  expect(err.name).toBe('MissingAnonymousSessionError');
});

test('anonymous.createSession sets the __a0_anon cookie and returns a token set', async () => {
  const app = createAnonApp();
  app.post('/anon/create', async (req, res) => {
    const tokenSet = await req.auth0.client.anonymous.createSession();
    res.json({ accessToken: tokenSet.accessToken, audience: tokenSet.audience });
  });

  const res = await request(app).post('/anon/create');

  expect(res.status).toBe(200);
  expect(typeof res.body.accessToken).toBe('string');

  const cookies = res.headers['set-cookie'] as string[] | undefined;
  const anonCookie = cookies?.some((c) => c.startsWith('__a0_anon'));
  expect(anonCookie).toBe(true);
});

test('anonymous.getAccessToken returns a cached token on second call (no extra network request)', async () => {
  let callCount = 0;
  server.use(
    http.post(`https://${domain}/anonymous/token`, () => {
      callCount++;
      return HttpResponse.json({
        access_token: anonAccessToken,
        token_type: 'N_A',
        expires_in: 7200,
        session_token: SESSION_TOKEN,
        session_expires_in: 2592000,
      });
    })
  );

  const app = createAnonApp();
  app.post('/anon/create', async (req, res) => {
    const tokenSet = await req.auth0.client.anonymous.createSession();
    res.json({ accessToken: tokenSet.accessToken });
  });
  app.get('/anon/token', async (req, res) => {
    const tokenSet = await req.auth0.client.anonymous.getAccessToken();
    res.json({ accessToken: tokenSet.accessToken });
  });

  // Create session — establishes __a0_anon cookie
  const createRes = await request(app).post('/anon/create');
  const anonCookieValue = (createRes.headers['set-cookie'] as string[])
    .find((c) => c.startsWith('__a0_anon'))
    ?.split(';')[0] ?? '';

  // Two getAccessToken calls in separate requests — both should be cache hits
  const first = await request(app).get('/anon/token').set('cookie', anonCookieValue);
  const second = await request(app).get('/anon/token').set('cookie', anonCookieValue);

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.body.accessToken).toBe(second.body.accessToken);
  expect(callCount).toBe(1); // only createSession hit the network
});

test('anonymous.getSession returns sub and metadata after createSession', async () => {
  const app = createAnonApp();
  app.post('/anon/create', async (req, res) => {
    await req.auth0.client.anonymous.createSession();
    res.json({});
  });
  app.get('/anon/session', async (req, res) => {
    const session = await req.auth0.client.anonymous.getSession();
    res.json({ sub: session?.sub ?? null });
  });

  const createRes = await request(app).post('/anon/create');
  const anonCookieValue = (createRes.headers['set-cookie'] as string[])
    .find((c) => c.startsWith('__a0_anon'))
    ?.split(';')[0] ?? '';

  const sessionRes = await request(app).get('/anon/session').set('cookie', anonCookieValue);

  expect(sessionRes.status).toBe(200);
  expect(sessionRes.body.sub).toBe('anon@test-session-id');
});

test('anonymous.getSession returns undefined when __a0_anon cookie is absent', async () => {
  const app = createAnonApp();
  app.get('/anon/session', async (req, res) => {
    const session = await req.auth0.client.anonymous.getSession();
    res.json({ session: session ?? null });
  });

  const res = await request(app).get('/anon/session');

  expect(res.status).toBe(200);
  expect(res.body.session).toBeNull();
});

test('anonymous.logout clears the __a0_anon cookie', async () => {
  const app = createAnonApp();

  app.post('/anon/create', async (req, res) => {
    await req.auth0.client.anonymous.createSession();
    res.json({});
  });

  app.post('/anon/logout', async (req, res) => {
    await req.auth0.client.anonymous.logout();
    res.json({});
  });

  const createRes = await request(app).post('/anon/create');
  const cookies = createRes.headers['set-cookie'] as string[];
  const anonCookieHeader = cookies.find((c) => c.startsWith('__a0_anon'));
  const anonCookieValue = anonCookieHeader?.split(';')[0];

  const logoutRes = await request(app)
    .post('/anon/logout')
    .set('cookie', anonCookieValue ?? '');

  // Express clearCookie sets Max-Age=0 / Expires in the past
  const setCookies = logoutRes.headers['set-cookie'] as string[] | undefined;
  const cleared = setCookies?.some(
    (c) => c.startsWith('__a0_anon') && (c.includes('Max-Age=0') || c.includes('Expires='))
  );
  expect(cleared).toBe(true);
});

test('MissingAnonymousSessionError thrown when getAccessToken called with no session', async () => {
  const app = createAnonApp();
  app.get('/anon/token', async (req, res) => {
    try {
      await req.auth0.client.anonymous.getAccessToken();
      res.status(200).json({});
    } catch (e) {
      res.status(401).json({ isMissing: e instanceof MissingAnonymousSessionError });
    }
  });

  const res = await request(app).get('/anon/token');

  expect(res.status).toBe(401);
  expect(res.body.isMissing).toBe(true);
});

test('AnonymousSessionExpiredError thrown when session_expired returned on re-mint', async () => {
  // Call sequence (auth0-auth-js v1.16.1+):
  //   1 → createSession  (returns stale token, expires_in=0)
  //   2 → re-mint attempt (returns session_expired 400)
  //     → auth0-auth-js throws AnonymousSessionError
  //     → server-js catches and throws AnonymousSessionExpiredError
  let callNum = 0;
  server.use(
    http.post(`https://${domain}/anonymous/token`, async () => {
      callNum++;
      if (callNum === 1) {
        return HttpResponse.json({
          access_token: anonAccessToken,
          token_type: 'N_A',
          expires_in: 0,
          session_token: SESSION_TOKEN,
          session_expires_in: 2592000,
        });
      }
      return HttpResponse.json(
        { error: 'session_expired', error_description: 'Session has expired' },
        { status: 400 }
      );
    })
  );

  const app = createAnonApp();
  app.post('/anon/create', async (req, res) => {
    await req.auth0.client.anonymous.createSession();
    res.json({});
  });
  app.get('/anon/token', async (req, res) => {
    try {
      await req.auth0.client.anonymous.getAccessToken();
      res.status(200).json({});
    } catch (e) {
      res.status(410).json({ isExpired: e instanceof AnonymousSessionExpiredError });
    }
  });

  const createRes = await request(app).post('/anon/create');
  const anonCookieValue = (createRes.headers['set-cookie'] as string[])
    .find((c) => c.startsWith('__a0_anon'))
    ?.split(';')[0] ?? '';

  // getAccessToken with the stale cookie → should trigger session_expired → AnonymousSessionExpiredError
  const tokenRes = await request(app).get('/anon/token').set('cookie', anonCookieValue);

  expect(tokenRes.status).toBe(410);
  expect(tokenRes.body.isExpired).toBe(true);
});

test('accessing client.anonymous without anonymousSessions throws InvalidConfigurationError', async () => {
  const app = createAnonApp({ anonymousSessions: undefined });

  app.get('/anon/check', async (req, res) => {
    try {
      await req.auth0.client.anonymous.getSession();
      res.status(200).json({});
    } catch (e) {
      res.status(500).json({ isConfig: e instanceof InvalidConfigurationError });
    }
  });

  const res = await request(app).get('/anon/check');

  expect(res.status).toBe(500);
  expect(res.body.isConfig).toBe(true);
});

test('anonymousSessions with options passes sessionTokenLifetime to store', async () => {
  // Omit session_expires_in so StatelessAnonymousStore falls back to sessionTokenLifetime for Max-Age
  server.use(
    http.post(`https://${domain}/anonymous/token`, () =>
      HttpResponse.json({
        access_token: anonAccessToken,
        token_type: 'N_A',
        expires_in: 7200,
        session_token: SESSION_TOKEN,
        // no session_expires_in → store uses sessionTokenLifetime as Max-Age
      })
    )
  );

  const app = createAnonApp({
    anonymousSessions: { sessionTokenLifetime: 7 * 24 * 60 * 60 }, // 7 days = 604800s
  });
  app.post('/anon/create', async (req, res) => {
    await req.auth0.client.anonymous.createSession();
    res.json({});
  });

  const res = await request(app).post('/anon/create');

  expect(res.status).toBe(200);
  const cookies = res.headers['set-cookie'] as string[];
  const anonCookie = cookies?.find((c) => c.startsWith('__a0_anon'));
  expect(anonCookie).toContain('Max-Age=604800');
});

test('anonymousSessions.clearOnLogin: false keeps __a0_anon cookie after login', async () => {
  const { encrypt } = await import('./test-utils/encryption.js');
  const { generateToken } = await import('./test-utils/tokens.js');

  const idToken = await generateToken(domain, 'user_123', '<client_id>');
  const userAccessToken = await generateToken(domain, 'user_123');

  server.use(
    http.post(`https://${domain}/custom/token`, () =>
      HttpResponse.json({
        access_token: userAccessToken,
        id_token: idToken,
        expires_in: 86400,
        token_type: 'Bearer',
      })
    )
  );

  const app = createAnonApp({ anonymousSessions: { clearOnLogin: false } });

  app.post('/anon/create', async (req, res) => {
    await req.auth0.client.anonymous.createSession();
    res.json({});
  });

  // Create anonymous session
  const createRes = await request(app).post('/anon/create');
  const anonCookieHeader = (createRes.headers['set-cookie'] as string[]).find((c) =>
    c.startsWith('__a0_anon')
  );
  const anonCookieValue = anonCookieHeader?.split(';')[0] ?? '';

  // Complete login callback with the anonymous cookie present
  const txCookieName = '__a0_tx';
  const txCookieValue = await encrypt({}, '<secret>', txCookieName, Date.now() + 10000);
  const callbackRes = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${txCookieName}=${txCookieValue}; ${anonCookieValue}`);

  expect(callbackRes.status).toBe(302);

  // __a0_anon should NOT be cleared (anonymousSessions.clearOnLogin: false)
  const setCookies = callbackRes.headers['set-cookie'] as string[] | undefined;
  const anonCleared = setCookies?.some(
    (c) => c.startsWith('__a0_anon') && (c.includes('Max-Age=0') || c.includes('Expires='))
  );
  expect(anonCleared).toBeFalsy();
});
