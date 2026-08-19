import { expect, test, afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { generateToken, jwks } from './test-utils/tokens.js';
import express from 'express';
import request from 'supertest';
import { createAuth0Api, requiresAuth } from './index.js';

const domain = 'auth0.local';
let mockOpenIdConfiguration = {
  issuer: `https://${domain}/`,
  authorization_endpoint: `https://${domain}/authorize`,
  backchannel_authentication_endpoint: `https://${domain}/custom-authorize`,
  token_endpoint: `https://${domain}/custom/token`,
  end_session_endpoint: `https://${domain}/logout`,
  jwks_uri: `https://${domain}/.well-known/jwks.json`,
};

const restHandlers = [
  http.get(`https://${domain}/.well-known/openid-configuration`, () => {
    return HttpResponse.json(mockOpenIdConfiguration);
  }),
  http.get(`https://${domain}/.well-known/jwks.json`, () => {
    return HttpResponse.json({ keys: jwks });
  }),
  http.post(mockOpenIdConfiguration.token_endpoint, async () => {
    const accessToken = await generateToken(domain, 'user_123');
    return HttpResponse.json({
      access_token: accessToken,
      id_token: await generateToken(domain, 'user_123', '<client_id>'),
      expires_in: 60,
      token_type: 'Bearer',
    });
  }),
];

const server = setupServer(...restHandlers);

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));

// Close server after all tests
afterAll(() => server.close());

afterEach(() => {
  mockOpenIdConfiguration = {
    issuer: `https://${domain}/`,
    authorization_endpoint: `https://${domain}/authorize`,
    backchannel_authentication_endpoint: `https://${domain}/custom-authorize`,
    token_endpoint: `https://${domain}/custom/token`,
    end_session_endpoint: `https://${domain}/logout`,
    jwks_uri: `https://${domain}/.well-known/jwks.json`,
  };
  server.resetHandlers();
});

test('should return 401 when no token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  router.get('/test', requiresAuth(), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test');

  expect(res.status).toBe(401);
  expect(res.headers['www-authenticate']).toBe('Bearer');
  expect(res.body.error).toBeUndefined();
});

test('should return 200 when valid token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  router.get('/test', requiresAuth(), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe('OK');
});

test('should expose the verified access token on the request', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  // Read out of band rather than returned in the body. The docs tell consumers
  // to keep this credential out of responses, so the tests do the same.
  let capturedToken: string | undefined;

  router.get('/test', requiresAuth(), async (req, res) => {
    capturedToken = req.auth0.token;
    res.json({ sub: req.auth0.user?.sub });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(capturedToken).toBe(accessToken);
  expect(res.body.sub).toBe('user_123');
});

test('should return 401 when no issuer in token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', undefined, false);

  router.get('/test', requiresAuth(), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('invalid_token');
  expect(res.body.error_description).toBe('missing required "iss" claim');
});

test('should return 401 when invalid issuer in token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>', 'https://invalid-issuer.local');

  router.get('/test', requiresAuth(), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('invalid_token');
  expect(res.body.error_description).toBe('unexpected "iss" claim value');
});

test('should return 401 when no audience in token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123');

  router.get('/test', requiresAuth(), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('invalid_token');
  expect(res.body.error_description).toBe('missing required "aud" claim');
});

test('should return 401 when no iat in token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>', undefined, false, undefined, {
    scope: 'valid',
  });

  router.get('/test', requiresAuth(), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('invalid_token');
  expect(res.body.error_description).toBe('missing required "iat" claim');
});

test('should return 401 when no exp in token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>', undefined, undefined, false);

  router.get('/test', requiresAuth(), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('invalid_token');
  expect(res.body.error_description).toBe('missing required "exp" claim');
});

test('should return 401 when invalid audience in token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<invalid_audience>');

  router.get('/test', requiresAuth(), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('invalid_token');
  expect(res.body.error_description).toBe('unexpected "aud" claim value');
});

test('should throw when no audience configured', async () => {
  expect(() => {
    createAuth0Api({
      domain: domain,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }).toThrowError("'audience' is required. Provide it via config or AUTH0_AUDIENCE environment variable.");
});

test('should return 403 when invalid scope in token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
    scope: 'invalid',
  });

  router.get('/test', requiresAuth({ scopes: 'valid' }), async (req, res) => {
    res.send('OK');
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(403);
  expect(res.body.error).toBe('insufficient_scope');
  expect(res.body.error_description).toBe('Insufficient scopes');
});

test('should return 200 when valid audience in token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  router.get('/test', requiresAuth(), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe('OK');
});

test('should return 200 when valid scope in token', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
    scope: 'valid',
  });

  router.get('/test', requiresAuth({ scopes: 'valid' }), async (req, res) => {
    res.json({ message: 'OK' });
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe('OK');
});

test('should exchange the verified token on behalf of the user', async () => {
  let body: URLSearchParams | undefined;

  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, async ({ request: req }) => {
      body = new URLSearchParams(await req.text());
      return HttpResponse.json({
        access_token: '<downstream-token>',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        expires_in: 3600,
        scope: 'read:orders',
        token_type: 'Bearer',
      });
    })
  );

  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  router.get('/test', requiresAuth(), async (req, res) => {
    const tokenSet = await req.auth0.client.getTokenOnBehalfOf(req.auth0.token!, {
      audience: 'https://orders.example.com',
      scope: 'read:orders',
    });
    res.json(tokenSet);
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(res.body.accessToken).toBe('<downstream-token>');
  expect(res.body.scope).toBe('read:orders');
  // Normalised to lowercase on the way through oauth4webapi.
  expect(res.body.tokenType).toBe('bearer');
  expect(typeof res.body.expiresAt).toBe('number');

  // The token the request was authenticated with is what gets exchanged.
  expect(Object.fromEntries(body!.entries())).toEqual({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: accessToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: 'https://orders.example.com',
    scope: 'read:orders',
    client_id: '<client_id>',
    client_secret: '<client_secret>',
  });
});

test('should exchange an explicitly provided subject token', async () => {
  let body: URLSearchParams | undefined;

  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, async ({ request: req }) => {
      body = new URLSearchParams(await req.text());
      return HttpResponse.json({
        access_token: '<downstream-token>',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    })
  );

  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
  });

  // No requiresAuth() and no Authorization header. The client is attached to
  // every request, so a route can exchange a token it got from somewhere else.
  router.get('/test', async (req, res) => {
    const tokenSet = await req.auth0.client.getTokenOnBehalfOf('<background-job-token>', {
      audience: 'https://orders.example.com',
    });
    res.json(tokenSet);
  });

  app.use(router);

  const res = await request(app).get('/test');

  expect(res.status).toBe(200);
  expect(res.body.accessToken).toBe('<downstream-token>');
  expect(body!.get('subject_token')).toBe('<background-job-token>');
});

test('should throw when there is no subject token to exchange', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
  });

  let error: Error | undefined;

  // `requiresAuth()` never ran, so `req.auth0.token` is undefined and the
  // non-null assertion the route makes is wrong.
  router.get('/test', async (req, res) => {
    try {
      await req.auth0.client.getTokenOnBehalfOf(req.auth0.token!, { audience: 'https://orders.example.com' });
    } catch (e) {
      error = e as Error;
    }
    res.json({ message: error?.message });
  });

  app.use(router);

  const res = await request(app).get('/test');

  expect(res.status).toBe(200);
  expect(res.body.message).toContain('subject_token is required');
  expect(error).toHaveProperty('code', 'token_exchange_error');
});

test('should throw when exchanging without client credentials configured', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  let error: Error | undefined;

  router.get('/test', requiresAuth(), async (req, res) => {
    try {
      await req.auth0.client.getTokenOnBehalfOf(req.auth0.token!, { audience: 'https://orders.example.com' });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as Error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toContain('client secret or client assertion signing key must be provided');
  expect(error).toHaveProperty('code', 'missing_client_auth_error');
});

test('should throw when exchanging with a client id but no secret or assertion key', async () => {
  const app = express();
  app.use(express.json());

  // A half-configured client. `clientId` alone cannot authenticate, so this is
  // the same failure as having no credentials at all.
  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  let error: Error | undefined;

  router.get('/test', requiresAuth(), async (req, res) => {
    try {
      await req.auth0.client.getTokenOnBehalfOf(req.auth0.token!, { audience: 'https://orders.example.com' });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as Error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(error).toHaveProperty('code', 'missing_client_auth_error');
});

test('should surface what the tenant said when the exchange is rejected', async () => {
  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, () =>
      HttpResponse.json(
        {
          error: 'access_denied',
          error_description: 'Client is not authorized to access https://orders.example.com.',
        },
        { status: 403 }
      )
    )
  );

  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  let error: (Error & { code?: string; cause?: { error?: string; error_description?: string } }) | undefined;

  router.get('/test', requiresAuth(), async (req, res) => {
    try {
      await req.auth0.client.getTokenOnBehalfOf(req.auth0.token!, { audience: 'https://orders.example.com' });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as typeof error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(error).toHaveProperty('code', 'token_exchange_error');
  // The tenant's own wording is preserved on `cause`, which is what a consumer
  // needs to tell a misconfigured tenant apart from a bad request.
  expect(error?.cause?.error).toBe('access_denied');
  expect(error?.cause?.error_description).toBe('Client is not authorized to access https://orders.example.com.');
});
