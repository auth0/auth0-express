import express from 'express';
import type { Express, Response } from 'express';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createAuth0, requiresAuth } from '../index.js';
import type { Auth0Options } from '../types.js';
import type { serve } from './serve.js';
import { generateToken } from './tokens.js';

export const POPPY_DOMAIN = 'auth.zepto.example';
export const POPPY_CLIENT_ID = 'web_app_client';
export const POPPY_SECRET = 'a-secret-that-is-at-least-32-characters-long';
export const APP_BASE_URL = 'https://zepto.example';
export const CIMD_URL = 'https://agent.example/agent.json';
export const SESSION_ID = 'Yx2b7Qd_Kp8mR3vT1nWc4A';
export const USER_ID = 'usr_Q7c1vK';
export const AGENT_ID = 'travel_agent';
export const SESSION_KEY = 'TCKalJy8Oz7hl1YTKAJt86LQcaiaLsYmFX-cLwiaJ4c';
export const GUEST_SUB = 'anon_poppy@z4eHq6gTjlgaMSjrplb3j5j3kb3hEDz9hZx8mgdxQLg';
export const GUEST_SUB_PROFILE = 'user urn:auth0:anonymous_user';
export const JOIN_ACCESS_TOKEN = 'at_join';

const ANONYMOUS_SESSION_TOKEN = 'ANONYMOUS_SESSION_' + 'a'.repeat(64);

// Not annotated on purpose: it has members that `PoppyConfig` does not declare, as a real file can.
export const poppyConfig = {
  protocol_version: '0.3',
  organization: { name: 'Zepto', domain: 'zepto.example' },
  issuer: 'https://auth.zepto.example/',
  scopes: {
    'orders:read': { description: 'See your orders.', hints: { changes: 'none', personal_data: true } },
  },
  apis: [
    {
      type: 'openapi',
      url: 'https://zepto.example/api/openapi.json',
      description: 'Orders',
      identifier: 'https://zepto.example/api',
      public_origin: 'https://zepto.example',
    },
  ],
  web: {
    client_id: 'web_app_client',
    browser_session_endpoint: 'https://auth.zepto.example/poppy/web_app_client/browser-session',
  },
  agents: ['https://agent.example/agent.json'],
};

/** The `act` claim that an agent's browser join carries. */
export const act = { sub: CIMD_URL, poppy_sid: SESSION_ID, poppy_user_id: USER_ID };

/** An ID token for a guest: an agent's browser that joined without signing in. */
export function guestIdToken(claims?: Record<string, unknown>, expiresAt?: number) {
  return generateToken(POPPY_DOMAIN, GUEST_SUB, POPPY_CLIENT_ID, undefined, undefined, expiresAt, {
    sub_profile: GUEST_SUB_PROFILE,
    act,
    ...claims,
  });
}

/** An ID token for a signed-in user whose session has an agent in `act`. */
export function agentIdToken(sub = 'auth0|ana', claims?: Record<string, unknown>, expiresAt?: number) {
  return generateToken(POPPY_DOMAIN, sub, POPPY_CLIENT_ID, undefined, undefined, expiresAt, { act, ...claims });
}

/** An ID token for a person's own login, with no agent. */
export function humanIdToken(sub = 'auth0|person', claims?: Record<string, unknown>) {
  return generateToken(POPPY_DOMAIN, sub, POPPY_CLIENT_ID, undefined, undefined, undefined, claims);
}

/**
 * A mock Auth0 tenant for the Poppy domain. Listen on `server` in the spec. The token endpoint answers with the ID
 * token that was set last, and `parBodies` collects the bodies of the pushed authorization requests.
 */
export function poppyTenant() {
  let currentIdToken: string | undefined;
  const parBodies: string[] = [];

  const server = setupServer(
    http.get(`https://${POPPY_DOMAIN}/.well-known/openid-configuration`, () =>
      HttpResponse.json({
        issuer: `https://${POPPY_DOMAIN}/`,
        authorization_endpoint: `https://${POPPY_DOMAIN}/authorize`,
        token_endpoint: `https://${POPPY_DOMAIN}/oauth/token`,
        end_session_endpoint: `https://${POPPY_DOMAIN}/oidc/logout`,
        pushed_authorization_request_endpoint: `https://${POPPY_DOMAIN}/oauth/par`,
      })
    ),
    http.post(`https://${POPPY_DOMAIN}/oauth/token`, () =>
      HttpResponse.json({
        id_token: currentIdToken,
        access_token: JOIN_ACCESS_TOKEN,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile',
      })
    ),
    http.post(`https://${POPPY_DOMAIN}/oauth/par`, async ({ request }) => {
      parBodies.push(await request.text());
      return HttpResponse.json(
        { request_uri: 'urn:ietf:params:oauth:request_uri:abc', expires_in: 60 },
        { status: 201 }
      );
    }),
    http.post(`https://${POPPY_DOMAIN}/anonymous/token`, async () =>
      HttpResponse.json({
        access_token: await generateToken(POPPY_DOMAIN, 'anon@test-session-id'),
        token_type: 'N_A',
        expires_in: 7200,
        session_token: ANONYMOUS_SESSION_TOKEN,
        session_expires_in: 2592000,
      })
    )
  );

  return {
    server,
    setIdToken(token: string) {
      currentIdToken = token;
    },
    parBodies,
  };
}

export type PoppyTenant = ReturnType<typeof poppyTenant>;

/** The options of a Poppy website for the tests. `extra` comes last, so it can override any of them. */
export function poppyAuth0Options(extra?: Partial<Auth0Options>): Partial<Auth0Options> {
  return {
    domain: POPPY_DOMAIN,
    clientId: POPPY_CLIENT_ID,
    clientSecret: 'shh',
    appBaseUrl: APP_BASE_URL,
    sessionSecret: POPPY_SECRET,
    discoveryCache: { ttl: 0 },
    poppy: { config: poppyConfig },
    ...extra,
  };
}

function failed(res: Response, error: unknown) {
  res.status(500).json({ error: error instanceof Error ? error.name : 'Error' });
}

/**
 * An Express app with the Auth0 router at `mount` (the root by default) and three routes under the same prefix:
 * `GET /visitor`, `GET /user` and `GET /private`. The app has no cookie parser of its own.
 */
export function poppyApp(extra?: Partial<Auth0Options>, mount = ''): Express {
  const app = express();
  const router = createAuth0(poppyAuth0Options(extra));

  if (mount) {
    app.use(mount, router);
  } else {
    app.use(router);
  }

  app.get(`${mount}/visitor`, async (req, res) => {
    try {
      res.json(await req.auth0.client.poppy.getVisitor());
    } catch (error) {
      failed(res, error);
    }
  });

  app.get(`${mount}/user`, async (req, res) => {
    try {
      res.json({ user: (await req.auth0.client.getUser()) ?? null });
    } catch (error) {
      failed(res, error);
    }
  });

  app.get(`${mount}/private`, requiresAuth(), (_req, res) => {
    res.send('private');
  });

  return app;
}

/** What the helpers read from a response: its headers, as supertest and Node give them. */
type ResponseWithHeaders = { headers: Record<string, string | string[] | undefined> };

/** The raw `Set-Cookie` lines of a response. */
export function setCookieLines(res: ResponseWithHeaders): string[] {
  const lines = res.headers['set-cookie'];
  if (lines === undefined) return [];
  return Array.isArray(lines) ? lines : [lines];
}

/**
 * The cookies a browser would keep, by name. It ignores `Path`, `Domain` and `Secure`. `names()` lists them in the
 * order they were first set.
 */
export function cookieJar() {
  const cookies = new Map<string, string>();

  return {
    /** Adds each cookie that the response sets, and removes one that it empties or expires in 1970. */
    take(res: ResponseWithHeaders) {
      for (const line of setCookieLines(res)) {
        const [pair = '', ...attributes] = line.split(';');
        const equals = pair.indexOf('=');
        const name = pair.slice(0, equals).trim();
        const value = pair.slice(equals + 1).trim();
        const expired = attributes.some((attribute) => /^\s*expires\s*=.*\b1970\b/i.test(attribute));

        if (value === '' || expired) {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      }
    },
    /** The value of the `Cookie` request header. */
    header() {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    /** The value of the cookie, or `undefined` when the jar holds none of that name. */
    get(name: string) {
      return cookies.get(name);
    },
    /** Puts a cookie in the jar, as if a response had set it. */
    set(name: string, value: string) {
      cookies.set(name, value);
    },
    names() {
      return [...cookies.keys()];
    },
  };
}

export type CookieJar = ReturnType<typeof cookieJar>;

/**
 * Plays an agent's browser join: the login route, then the callback with `idToken` as the ID token of the tenant.
 * The jar carries the cookies from one request to the next. `loginQuery` starts with `?`.
 */
export async function join(
  agent: Awaited<ReturnType<typeof serve>>,
  jar: CookieJar,
  tenant: PoppyTenant,
  idToken: string | Promise<string>,
  loginQuery = ''
) {
  const login = await agent.get(`/auth/login${loginQuery}`).set('Cookie', jar.header());
  jar.take(login);

  tenant.setIdToken(await idToken);

  const callback = await agent.get('/auth/callback?code=abc').set('Cookie', jar.header());
  jar.take(callback);

  return { login, callback };
}
