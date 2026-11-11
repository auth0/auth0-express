import { describe, expect, test } from 'vitest';
import { createAuth0 } from '../router.js';
import { poppyApp, poppyAuth0Options, poppyConfig, setCookieLines } from '../test-utils/poppy.js';
import { serve } from '../test-utils/serve.js';
import { POPPY_DISCOVERY_PATHS } from './poppy-discovery-handler.js';

// No Auth0 tenant is needed here: the ServerClient builds both documents from the config when it is created.

const POPPY_JSON = '/.well-known/poppy.json';
const PROTECTED_RESOURCE = '/.well-known/oauth-protected-resource';

// The documents of the fixture config, byte for byte.
const POPPY_JSON_BODY =
  '{"protocol_version":"0.3","organization":{"name":"Zepto","domain":"zepto.example"},"auth":{"issuer":"https://auth.zepto.example/","scopes":{"orders:read":"See your orders."},"scope_hints":{"orders:read":{"changes":"none","personal_data":true}}},"web":{"browser_session_endpoint":"https://auth.zepto.example/poppy/web_app_client/browser-session"},"apis":[{"type":"openapi","url":"https://zepto.example/api/openapi.json","description":"Orders"}]}';
const PROTECTED_RESOURCE_BODY =
  '{"resource":"https://zepto.example","authorization_servers":["https://auth.zepto.example/"]}';

const BOTH_FILES = [
  [POPPY_JSON, POPPY_JSON_BODY],
  [PROTECTED_RESOURCE, PROTECTED_RESOURCE_BODY],
] as const;

describe('Poppy discovery routes', () => {
  describe('bodies and headers', () => {
    test('GET /.well-known/poppy.json sends the document and nothing else', async () => {
      const agent = await serve(poppyApp());

      const res = await agent.get(POPPY_JSON);

      expect(res.status).toBe(200);
      // `res.send()` would add `; charset=utf-8` and an ETag, so the handler ends the response with `res.end()`.
      expect(res.headers['content-type']).toBe('application/json');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers['content-length']).toBe('444');
      expect(res.headers).not.toHaveProperty('etag');
      expect(res.text).toBe(POPPY_JSON_BODY);
      expect(Buffer.byteLength(res.text)).toBe(444);
    });

    test('GET /.well-known/oauth-protected-resource sends the document and nothing else', async () => {
      const agent = await serve(poppyApp());

      const res = await agent.get(PROTECTED_RESOURCE);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/json');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers['content-length']).toBe(String(Buffer.byteLength(PROTECTED_RESOURCE_BODY)));
      expect(res.headers).not.toHaveProperty('etag');
      expect(res.text).toBe(PROTECTED_RESOURCE_BODY);
    });

    test('the protectedResource option changes the protected resource document and not poppy.json', async () => {
      const app = poppyApp({
        poppy: {
          config: poppyConfig,
          protectedResource: {
            authorization_servers: ['https://auth.zepto.example/', 'https://login.partner.example/'],
            scopes_supported: ['orders:read'],
          },
        },
      });
      const agent = await serve(app);

      const resource = await agent.get(PROTECTED_RESOURCE);
      expect(resource.status).toBe(200);
      expect(resource.text).toBe(
        '{"resource":"https://zepto.example","authorization_servers":["https://auth.zepto.example/","https://login.partner.example/"],"scopes_supported":["orders:read"]}'
      );

      const poppyJson = await agent.get(POPPY_JSON);
      expect(poppyJson.text).toBe(POPPY_JSON_BODY);
    });

    test.each(BOTH_FILES)(
      'Host and X-Forwarded-* headers do not change %s, behind a trusted proxy',
      async (path, body) => {
        const app = poppyApp();
        app.set('trust proxy', true);
        const agent = await serve(app);

        const plain = await agent.get(path);
        const hostile = await agent
          .get(path)
          .set('Host', 'evil.example')
          .set('X-Forwarded-Host', 'evil.example')
          .set('X-Forwarded-Proto', 'http');

        expect(plain.text).toBe(body);
        expect(hostile.status).toBe(200);
        expect(hostile.text).toBe(plain.text);
      }
    );
  });

  describe('no cookies, no session', () => {
    const cookies = '__a0_session.0=x; __a0_poppy.0=y';

    test.each([
      ['get', POPPY_JSON],
      ['head', POPPY_JSON],
      ['get', PROTECTED_RESOURCE],
      ['head', PROTECTED_RESOURCE],
    ] as const)('%s %s sets no cookie and never reaches the client attach', async (method, path) => {
      const app = poppyApp();
      const agent = await serve(app);

      const res = await agent[method](path).set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(setCookieLines(res)).toEqual([]);
      expect(app.locals.auth0Client).toBeUndefined();
    });

    // The route handles GET and HEAD only. Express answers an OPTIONS request itself, after the layers that come later
    // in the router (the cookie parser and the client attach), and it lists the methods of the route. That answer sets
    // no cookie either.
    test.each([POPPY_JSON, PROTECTED_RESOURCE])('options %s is answered by Express, with no cookie', async (path) => {
      const agent = await serve(poppyApp());

      const res = await agent.options(path).set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.headers['allow']).toBe('GET, HEAD');
      expect(setCookieLines(res)).toEqual([]);
    });

    test('control: a route behind the router does reach the client attach', async () => {
      const app = poppyApp();
      const agent = await serve(app);
      expect(app.locals.auth0Client).toBeUndefined();

      const res = await agent.get('/user');

      expect(res.status).toBe(200);
      expect(app.locals.auth0Client).toBeDefined();
    });
  });

  describe('first layer', () => {
    test('the first layer of the router is the route of both files', () => {
      const router = createAuth0(poppyAuth0Options());

      expect(router.stack[0]?.route?.path).toEqual(POPPY_DISCOVERY_PATHS);
      expect(POPPY_DISCOVERY_PATHS).toEqual([POPPY_JSON, PROTECTED_RESOURCE]);
    });

    test('without poppy the first layer is not a route', () => {
      const router = createAuth0(poppyAuth0Options({ poppy: undefined }));

      expect(router.stack[0]?.route).toBeUndefined();
    });
  });

  describe('HEAD', () => {
    test.each(BOTH_FILES)('HEAD %s gives the headers and an empty body', async (path) => {
      const agent = await serve(poppyApp());

      const res = await agent.head(path);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/json');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers).not.toHaveProperty('etag');
      expect(res.text ?? '').toBe('');
    });
  });

  describe('other requests', () => {
    test.each(['post', 'put'] as const)('%s gives 404 for both files', async (method) => {
      const agent = await serve(poppyApp());

      expect((await agent[method](POPPY_JSON)).status).toBe(404);
      expect((await agent[method](PROTECTED_RESOURCE)).status).toBe(404);
    });

    test.each([
      '/.well-known/POPPY.json',
      '/.well-known/poppy.json/',
      '/.well-known/poppy%2Ejson',
      '/.well-known/OAuth-Protected-Resource',
      '/.well-known/oauth-protected-resource/',
    ])('%s gives 404', async (path) => {
      const agent = await serve(poppyApp());

      const res = await agent.get(path);

      expect(res.status).toBe(404);
      expect(res.text).not.toContain('protocol_version');
      expect(res.text).not.toContain('authorization_servers');
    });

    test.each(BOTH_FILES)('%s?x=1 gives 200 with the document', async (path, body) => {
      const agent = await serve(poppyApp());

      const res = await agent.get(`${path}?x=1`);

      expect(res.status).toBe(200);
      expect(res.text).toBe(body);
    });
  });

  describe('sub-path mount', () => {
    test('mounted at /shop, the files are served under /shop and not at the root', async () => {
      const agent = await serve(poppyApp({}, '/shop'));

      const poppyJson = await agent.get(`/shop${POPPY_JSON}`);
      expect(poppyJson.status).toBe(200);
      expect(poppyJson.text).toBe(POPPY_JSON_BODY);

      const resource = await agent.get(`/shop${PROTECTED_RESOURCE}`);
      expect(resource.status).toBe(200);
      expect(resource.text).toBe(PROTECTED_RESOURCE_BODY);

      // Agents ask the root of the domain only (https://personalagentprotocol.org/docs/0.3/spec#discovery).
      expect((await agent.get(POPPY_JSON)).status).toBe(404);
      expect((await agent.get(PROTECTED_RESOURCE)).status).toBe(404);
    });
  });

  describe('mountRoutes: false', () => {
    test('serves neither file, and the client still has the documents', async () => {
      const app = poppyApp({ mountRoutes: false });
      app.get('/probe', (req, res) => {
        res.json({ status: req.auth0.client.poppy.getDiscoveryDocument(POPPY_JSON)?.status });
      });
      const agent = await serve(app);

      expect((await agent.get(POPPY_JSON)).status).toBe(404);
      expect((await agent.get(PROTECTED_RESOURCE)).status).toBe(404);

      const probe = await agent.get('/probe');
      expect(probe.status).toBe(200);
      expect(probe.body).toEqual({ status: 200 });
    });
  });

  describe('without poppy', () => {
    test.each([POPPY_JSON, PROTECTED_RESOURCE])('%s gives 404, and the request takes the normal path', async (path) => {
      const app = poppyApp({ poppy: undefined });
      const agent = await serve(app);
      expect(app.locals.auth0Client).toBeUndefined();

      const res = await agent.get(path);

      expect(res.status).toBe(404);
      expect(app.locals.auth0Client).toBeDefined();
    });
  });

  describe('a config file of a newer protocol version', () => {
    // Pins what the ServerClient serves for this file: the version, a scope the file adds and `web.unscoped` are served
    // as written, and the members of `web` that this version of the ServerClient does not know are left out.
    const newerConfig = {
      ...poppyConfig,
      protocol_version: '0.4',
      scopes: { ...poppyConfig.scopes, 'poppy:browser-sign-in': { description: 'Sign in the browser.' } },
      web: { ...poppyConfig.web, unscoped: true, disabled: false },
    };

    test('poppy.json keeps the version, the scope and unscoped, and drops disabled', async () => {
      const agent = await serve(poppyApp({ poppy: { config: newerConfig } }));

      const res = await agent.get(POPPY_JSON);

      expect(res.status).toBe(200);
      expect(res.text).toContain('"protocol_version":"0.4"');
      expect(res.text).toContain('"poppy:browser-sign-in":"Sign in the browser."');
      expect(res.text).not.toContain('disabled');

      const document = JSON.parse(res.text);
      expect(document.auth.scopes).toEqual({
        'orders:read': 'See your orders.',
        'poppy:browser-sign-in': 'Sign in the browser.',
      });
      expect(document.web).toEqual({
        browser_session_endpoint: 'https://auth.zepto.example/poppy/web_app_client/browser-session',
        unscoped: true,
      });
    });
  });
});
