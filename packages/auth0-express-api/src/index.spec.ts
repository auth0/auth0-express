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

test('should return 400 when no token', async () => {
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

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_request');
  expect(res.body.error_description).toBe('No Authorization provided');
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
