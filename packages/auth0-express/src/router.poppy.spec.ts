import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Express } from 'express';
import type { PoppyGuestData, PoppyGuestStore } from '@auth0/auth0-server-js';
import { InvalidConfigurationError } from './errors/index.js';
import type { Auth0Options, PoppyOptions, StoreOptions } from './types.js';
import {
  GUEST_SUB,
  POPPY_DOMAIN,
  cookieJar,
  guestIdToken,
  join as joinPoppy,
  poppyApp,
  poppyConfig,
  poppyTenant,
  setCookieLines,
} from './test-utils/poppy.js';
import { serve } from './test-utils/serve.js';

const tenant = poppyTenant();

beforeAll(() => tenant.server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => tenant.server.resetHandlers());
afterAll(() => tenant.server.close());

const RESOURCE_BODY = '{"resource":"https://zepto.example","authorization_servers":["https://auth.zepto.example/"]}';

const cannotRead = (path: string) =>
  `Invalid poppy configuration: cannot read the config file at "${path}". ` +
  'Put auth0-poppy.json there, set poppy.configPath to where it is, or pass the parsed file as poppy.config.';

function expectInvalidConfig(fn: () => unknown, message: string) {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(InvalidConfigurationError);
  expect((thrown as Error).message).toBe(message);
}

/** The attributes of a `Set-Cookie` line, without its name and value. */
function cookieAttributes(line: string | undefined) {
  expect(line).toBeDefined();
  return line!
    .split(';')
    .slice(1)
    .map((attribute) => attribute.trim());
}

function guestCookieLine(res: Parameters<typeof setCookieLines>[0]) {
  return setCookieLines(res).find((line) => line.startsWith('__a0_poppy.0='));
}

describe('createAuth0 with poppy', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'poppy-router-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Builds the app with `process.cwd()` at `dir`. The file is read while the app is built, and not after. */
  function build(extra?: Partial<Auth0Options>) {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    try {
      return poppyApp(extra);
    } finally {
      cwd.mockRestore();
    }
  }

  /** Asks the client of the app for the protected resource document, through a route that the test adds. */
  async function resourceBody(app: Express) {
    app.get('/resource', (req, res) => {
      res
        .type('text')
        .send(req.auth0.client.poppy.getDiscoveryDocument('/.well-known/oauth-protected-resource')?.body);
    });

    const res = await (await serve(app)).get('/resource');
    expect(res.status).toBe(200);
    return res.text;
  }

  describe('where the config comes from', () => {
    test.each<[string, true | PoppyOptions]>([
      ['true', true],
      ['{}', {}],
    ])('poppy: %s reads auth0-poppy.json from the working directory', async (_name, poppy) => {
      writeFileSync(join(dir, 'auth0-poppy.json'), JSON.stringify(poppyConfig));

      expect(await resourceBody(build({ poppy }))).toBe(RESOURCE_BODY);
    });

    test('poppy: true stops startup when the working directory has no auth0-poppy.json', () => {
      expectInvalidConfig(() => build({ poppy: true }), cannotRead(join(dir, 'auth0-poppy.json')));
    });

    test('configPath relative to the working directory', async () => {
      mkdirSync(join(dir, 'conf'));
      writeFileSync(join(dir, 'conf', 'site.json'), JSON.stringify(poppyConfig));

      expect(await resourceBody(build({ poppy: { configPath: 'conf/site.json' } }))).toBe(RESOURCE_BODY);
    });

    test('an absolute configPath, whatever the working directory is', async () => {
      const file = join(dir, 'site.json');
      writeFileSync(file, JSON.stringify(poppyConfig));

      expect(await resourceBody(poppyApp({ poppy: { configPath: file } }))).toBe(RESOURCE_BODY);
    });

    test('configPath as a file: URL', async () => {
      const file = join(dir, 'site.json');
      writeFileSync(file, JSON.stringify(poppyConfig));

      expect(await resourceBody(poppyApp({ poppy: { configPath: pathToFileURL(file) } }))).toBe(RESOURCE_BODY);
    });

    test('config wins: configPath is not read', async () => {
      const app = poppyApp({ poppy: { config: poppyConfig, configPath: '/does/not/exist.json' } });

      expect(await resourceBody(app)).toBe(RESOURCE_BODY);
    });

    test('a file that holds [] is refused by the ServerClient, with its text', () => {
      const file = join(dir, 'site.json');
      writeFileSync(file, '[]');

      expectInvalidConfig(
        () => poppyApp({ poppy: { configPath: file } }),
        'Invalid poppy configuration: config must be an object.'
      );
    });

    test('a config of null is refused by the ServerClient, and configPath is not read', () => {
      // null is not undefined, so the file does not take its place.
      expectInvalidConfig(
        () => poppyApp({ poppy: { config: null as never, configPath: '/does/not/exist.json' } }),
        'Invalid poppy configuration: config must be an object.'
      );
    });

    test('a config with another issuer is refused by the ServerClient, with its text', () => {
      expectInvalidConfig(
        () => poppyApp({ poppy: { config: { ...poppyConfig, issuer: 'https://other.example/' } } }),
        "Invalid poppy configuration: config.issuer must match Auth0's issuer for the ServerClient domain exactly, trailing slash included."
      );
    });

    test('without poppy nothing is read, and client.poppy says so', async () => {
      const app = build({ poppy: undefined });
      app.get('/poppy', (req, res) => {
        try {
          res.json({ available: Boolean(req.auth0.client.poppy) });
        } catch (error) {
          res.json({
            invalidConfiguration: error instanceof InvalidConfigurationError,
            message: (error as Error).message,
          });
        }
      });

      const res = await (await serve(app)).get('/poppy');

      expect(res.body).toEqual({
        invalidConfiguration: true,
        message: 'poppy is only available when the `poppy` option is configured on the ServerClient.',
      });
    });
  });

  describe('options passed to server-js', () => {
    test('agentSessionMaxAge: 0', () => {
      expectInvalidConfig(
        () => poppyApp({ poppy: { config: poppyConfig, agentSessionMaxAge: 0 } }),
        'Invalid poppy configuration: agentSessionMaxAge must be a positive whole number of seconds.'
      );
    });

    test('protectedResource with an empty resource', () => {
      expectInvalidConfig(
        () => poppyApp({ poppy: { config: poppyConfig, protectedResource: { resource: '' } } }),
        'Invalid poppy configuration: protectedResource.resource must be a non-empty string.'
      );
    });

    test('web.unscoped of the file reaches poppy.json', async () => {
      const config = { ...poppyConfig, web: { ...poppyConfig.web, unscoped: true } };

      const res = await (await serve(poppyApp({ poppy: { config } }))).get('/.well-known/poppy.json');

      expect(res.status).toBe(200);
      expect(res.body.web).toEqual({ browser_session_endpoint: poppyConfig.web.browser_session_endpoint, unscoped: true });
    });

    test('web.unscoped that is not a boolean', () => {
      const config = { ...poppyConfig, web: { ...poppyConfig.web, unscoped: 'yes' } };

      expectInvalidConfig(
        () => poppyApp({ poppy: { config: config as never } }),
        'Invalid poppy configuration: config.web.unscoped must be true or false, or left out.'
      );
    });

    test('a domain resolver', () => {
      expectInvalidConfig(
        () => poppyApp({ domain: () => POPPY_DOMAIN }),
        'Invalid poppy configuration: domain must be a string. A domain resolver is not supported because Poppy has one issuer.'
      );
    });

    test('enterpriseConnect', () => {
      expectInvalidConfig(
        () => poppyApp({ enterpriseConnect: true, onCallback: async () => undefined }),
        'Invalid poppy configuration: poppy cannot be combined with enterpriseConnect.'
      );
    });
  });

  describe('the default guest store', () => {
    test('a guest join sets the guest cookie and no session, and the guest is not a user', async () => {
      const agent = await serve(poppyApp());
      const jar = cookieJar();

      const { callback } = await joinPoppy(agent, jar, tenant, guestIdToken());

      expect(callback.status).toBe(302);
      expect(setCookieLines(callback).some((line) => line.startsWith('__a0_session'))).toBe(false);

      const attributes = cookieAttributes(guestCookieLine(callback));
      expect(attributes).toContain('HttpOnly');
      expect(attributes).toContain('Secure');
      expect(attributes).toContain('SameSite=Lax');
      expect(attributes).toContain('Path=/');
      expect(attributes.some((attribute) => /^Max-Age=\d+$/.test(attribute))).toBe(true);

      const user = await agent.get('/user').set('Cookie', jar.header());
      expect(user.body).toEqual({ user: null });

      const visitor = await agent.get('/visitor').set('Cookie', jar.header());
      expect(visitor.body.kind).toBe('guest');
    });

    test('the cookie option sets the attributes of the guest cookie', async () => {
      const app = poppyApp({
        poppy: { config: poppyConfig, cookie: { sameSite: 'strict', secure: false, path: '/shop' } },
      });

      const { callback } = await joinPoppy(await serve(app), cookieJar(), tenant, guestIdToken());

      const attributes = cookieAttributes(guestCookieLine(callback));
      expect(attributes).toContain('SameSite=Strict');
      expect(attributes).toContain('Path=/shop');
      expect(attributes).not.toContain('Secure');
    });

    test('the guest cookie does not follow sessionConfiguration.cookie', async () => {
      const app = poppyApp({ sessionConfiguration: { cookie: { sameSite: 'strict', secure: false, path: '/shop' } } });

      const { callback } = await joinPoppy(await serve(app), cookieJar(), tenant, guestIdToken());

      const attributes = cookieAttributes(guestCookieLine(callback));
      expect(attributes).toContain('SameSite=Lax');
      expect(attributes).toContain('Secure');
      expect(attributes).toContain('Path=/');
    });

    test('agentSessionMaxAge limits the life of the guest cookie', async () => {
      const app = poppyApp({ poppy: { config: poppyConfig, agentSessionMaxAge: 60 } });

      const { callback } = await joinPoppy(await serve(app), cookieJar(), tenant, guestIdToken());

      const maxAge = cookieAttributes(guestCookieLine(callback)).find((attribute) => attribute.startsWith('Max-Age='));
      expect(Number(maxAge?.slice('Max-Age='.length))).toBeGreaterThanOrEqual(1);
      expect(Number(maxAge?.slice('Max-Age='.length))).toBeLessThanOrEqual(60);
    });

    test('a secret array rotates the guest cookie as it does the session', async () => {
      const first = 'first-secret-that-is-at-least-32-chars';
      const second = 'second-secret-that-is-at-least-32-chars';
      const jar = cookieJar();
      await joinPoppy(await serve(poppyApp({ sessionSecret: first })), jar, tenant, guestIdToken());

      const rotated = await serve(poppyApp({ sessionSecret: [second, first] }));
      const rotatedVisitor = await rotated.get('/visitor').set('Cookie', jar.header());
      expect(rotatedVisitor.body.kind).toBe('guest');

      const replaced = await serve(poppyApp({ sessionSecret: second }));
      const replacedVisitor = await replaced.get('/visitor').set('Cookie', jar.header());
      expect(replacedVisitor.body).toEqual({ kind: 'none' });
    });

    test('a custom guestStore keeps the guest, and no guest cookie is set', async () => {
      const guests = new Map<string, PoppyGuestData>();
      const sets: { identifier: string; data: PoppyGuestData; options: unknown }[] = [];
      const guestStore: PoppyGuestStore<StoreOptions> = {
        async set(identifier, data, _removeIfExists, options) {
          sets.push({ identifier, data, options });
          guests.set(identifier, data);
        },
        async get(identifier) {
          return guests.get(identifier);
        },
        async delete(identifier) {
          guests.delete(identifier);
        },
      };
      const app = poppyApp({ poppy: { config: poppyConfig, guestStore, cookie: { secure: false } } });

      const { callback } = await joinPoppy(await serve(app), cookieJar(), tenant, guestIdToken());

      expect(sets).toHaveLength(1);
      expect(sets[0]?.identifier).toBe('__a0_poppy');
      expect(sets[0]?.data.sub).toBe(GUEST_SUB);
      expect(setCookieLines(callback).some((line) => line.startsWith('__a0_poppy'))).toBe(false);
      // The package calls the client without storeOptions, so a custom store gets no request.
      expect(sets[0]?.options).toBeUndefined();
    });
  });
});
