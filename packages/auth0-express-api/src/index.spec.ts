import { expect, test, afterAll, afterEach, beforeAll, describe, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, type HttpHandler } from 'msw';
import * as jose from 'jose';
import { generateToken, jwks } from './test-utils/tokens.js';
import { parseChallenge } from './test-utils/www-authenticate.js';
import express from 'express';
import request from 'supertest';
import {
  claimCheck,
  claimEquals,
  claimIncludes,
  createAuth0Api,
  isConnectionExchangeError,
  MissingClientAuthError,
  requiresAuth,
  scopesInclude,
} from './index.js';

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
  // api-js returns this lowercased, whatever case the tenant sent.
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

test('should exchange the verified token for a connection access token', async () => {
  let body: URLSearchParams | undefined;

  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, async ({ request: req }) => {
      body = new URLSearchParams(await req.text());
      return HttpResponse.json({
        access_token: '<google-token>',
        issued_token_type: 'http://auth0.com/oauth/token-type/federated-connection-access-token',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
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
    const tokenSet = await req.auth0.client.getAccessTokenForConnection({
      connection: 'google-oauth2',
      accessToken: req.auth0.token!,
    });
    res.json(tokenSet);
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(res.body.accessToken).toBe('<google-token>');
  expect(res.body.scope).toBe('https://www.googleapis.com/auth/calendar.readonly');
  // Echoed back from the options, not from the tenant's response.
  expect(res.body.connection).toBe('google-oauth2');
  expect(typeof res.body.expiresAt).toBe('number');

  // Token Vault has its own grant type, and no `audience`, which the tenant
  // rejects for this grant.
  expect(Object.fromEntries(body!.entries())).toEqual({
    grant_type: 'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token',
    connection: 'google-oauth2',
    subject_token: accessToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'http://auth0.com/oauth/token-type/federated-connection-access-token',
    client_id: '<client_id>',
    client_secret: '<client_secret>',
  });
});

test('should pass the login hint through to the connection exchange', async () => {
  let body: URLSearchParams | undefined;

  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, async ({ request: req }) => {
      body = new URLSearchParams(await req.text());
      return HttpResponse.json({
        access_token: '<google-token>',
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

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  router.get('/test', requiresAuth(), async (req, res) => {
    const tokenSet = await req.auth0.client.getAccessTokenForConnection({
      connection: 'google-oauth2',
      accessToken: req.auth0.token!,
      loginHint: 'user@example.com',
    });
    res.json(tokenSet);
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(body!.get('login_hint')).toBe('user@example.com');
  // Echoed back on the result so a caller can tell which identity was used.
  expect(res.body.loginHint).toBe('user@example.com');
});

test('should throw when getting a connection token without client credentials configured', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  let error: (Error & { code?: string; cause?: unknown }) | undefined;

  router.get('/test', requiresAuth(), async (req, res) => {
    try {
      await req.auth0.client.getAccessTokenForConnection({
        connection: 'google-oauth2',
        accessToken: req.auth0.token!,
      });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as typeof error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  // With nothing configured, Token Vault reports its own error rather than the
  // `missing_client_auth_error` the other two exchanges use. A `clientId` with no
  // secret is a different code again, which the next test pins.
  expect(error).toHaveProperty('code', 'token_for_connection_error');
  expect(res.body.message).toContain('Client credentials are required');
  // Raised locally, so there is nothing from the tenant to attach.
  expect(error?.cause).toBeUndefined();
  // The exported guard has to match what api-js really throws, not just the
  // shape `errors.spec.ts` builds by hand.
  expect(isConnectionExchangeError(error)).toBe(true);
});

test('should throw missing client auth for a connection token with a client id but no secret', async () => {
  const app = express();
  app.use(express.json());

  // A half-configured client gets past the credential check inside api-js, so
  // this is the one failure here that is not a `token_for_connection_error`. A
  // consumer narrowing only on that code misses it.
  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
  });

  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  let error: (Error & { code?: string; cause?: unknown }) | undefined;

  router.get('/test', requiresAuth(), async (req, res) => {
    try {
      await req.auth0.client.getAccessTokenForConnection({
        connection: 'google-oauth2',
        accessToken: req.auth0.token!,
      });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as typeof error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  expect(error).toBeInstanceOf(MissingClientAuthError);
  expect(error).toHaveProperty('code', 'missing_client_auth_error');
  expect(res.body.message).toContain('client secret or client assertion signing key must be provided');
  expect(error?.cause).toBeUndefined();
  // Deliberately not a connection exchange failure, so a route that only checks
  // the guard has to fall through to its own configuration branch.
  expect(isConnectionExchangeError(error)).toBe(false);
});

test('should throw when there is no subject token for the connection exchange', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
  });

  let error: Error | undefined;

  // `requiresAuth()` never ran, so `req.auth0.token` is undefined.
  router.get('/test', async (req, res) => {
    try {
      await req.auth0.client.getAccessTokenForConnection({
        connection: 'google-oauth2',
        accessToken: req.auth0.token!,
      });
    } catch (e) {
      error = e as Error;
    }
    res.json({ message: error?.message });
  });

  app.use(router);

  const res = await request(app).get('/test');

  expect(res.status).toBe(200);
  expect(res.body.message).toContain('access token must be specified');
  expect(error).toHaveProperty('code', 'token_for_connection_error');
});

test('should surface what the tenant said when the connection exchange is rejected', async () => {
  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, () =>
      HttpResponse.json(
        {
          error: 'invalid_request',
          error_description: 'The connection google-oauth2 is not enabled for Token Vault.',
        },
        { status: 400 }
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
      await req.auth0.client.getAccessTokenForConnection({
        connection: 'google-oauth2',
        accessToken: req.auth0.token!,
      });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as typeof error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(res.status).toBe(200);
  // A tenant rejection reuses the same code as the local failure above, so
  // `cause` is the only thing that tells the two apart.
  expect(error).toHaveProperty('code', 'token_for_connection_error');
  expect(error?.cause?.error).toBe('invalid_request');
  expect(error?.cause?.error_description).toBe('The connection google-oauth2 is not enabled for Token Vault.');
  // Same guard, both sides of the `cause` split.
  expect(isConnectionExchangeError(error)).toBe(true);
});

test('should exchange an external token through a token exchange profile', async () => {
  let body: URLSearchParams | undefined;

  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, async ({ request: req }) => {
      body = new URLSearchParams(await req.text());
      return HttpResponse.json({
        access_token: '<auth0-token>',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        expires_in: 3600,
        scope: 'read:data',
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

  // No requiresAuth(). The subject is a token from another system, so there is
  // no Auth0 token to verify yet. That is the point of the flow.
  router.post('/test', async (req, res) => {
    const result = await req.auth0.client.getTokenByExchangeProfile(req.body.token, {
      subjectTokenType: 'urn:acme:legacy-token',
      audience: 'https://api.example.com',
      scope: 'read:data',
    });
    res.json(result);
  });

  app.use(router);

  const res = await request(app).post('/test').send({ token: '<legacy-token>' });

  expect(res.status).toBe(200);
  expect(res.body.accessToken).toBe('<auth0-token>');
  expect(res.body.scope).toBe('read:data');
  expect(res.body.issuedTokenType).toBe('urn:ietf:params:oauth:token-type:access_token');
  expect(typeof res.body.expiresAt).toBe('number');

  // The standard RFC 8693 grant type, with the profile identified by
  // `subject_token_type` rather than by a grant type of its own.
  expect(Object.fromEntries(body!.entries())).toEqual({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: '<legacy-token>',
    subject_token_type: 'urn:acme:legacy-token',
    audience: 'https://api.example.com',
    scope: 'read:data',
    client_id: '<client_id>',
    client_secret: '<client_secret>',
  });
});

test('should pass the organization and requested token type through to the profile exchange', async () => {
  let body: URLSearchParams | undefined;

  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, async ({ request: req }) => {
      body = new URLSearchParams(await req.text());
      return HttpResponse.json({
        access_token: '<auth0-token>',
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

  router.post('/test', async (req, res) => {
    const result = await req.auth0.client.getTokenByExchangeProfile('<legacy-token>', {
      subjectTokenType: 'urn:acme:legacy-token',
      audience: 'https://api.example.com',
      organization: 'org_abc123',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
    });
    res.json(result);
  });

  app.use(router);

  const res = await request(app).post('/test');

  expect(res.status).toBe(200);
  expect(body!.get('organization')).toBe('org_abc123');
  expect(body!.get('requested_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token');
});

test('should throw when exchanging a profile token without client credentials configured', async () => {
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
  });

  let error: Error | undefined;

  router.post('/test', async (req, res) => {
    try {
      await req.auth0.client.getTokenByExchangeProfile('<legacy-token>', {
        subjectTokenType: 'urn:acme:legacy-token',
        audience: 'https://api.example.com',
      });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as Error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).post('/test');

  expect(res.status).toBe(200);
  // Unlike Token Vault, this one reports the shared credential error.
  expect(error).toHaveProperty('code', 'missing_client_auth_error');
  expect(res.body.message).toContain('client secret or client assertion signing key must be provided');
});

test('should surface what the tenant said when the profile exchange is rejected', async () => {
  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, () =>
      HttpResponse.json(
        {
          error: 'invalid_request',
          error_description: 'No token exchange profile matches subject_token_type urn:acme:legacy-token.',
        },
        { status: 400 }
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

  let error: (Error & { code?: string; cause?: { error?: string; error_description?: string } }) | undefined;

  router.post('/test', async (req, res) => {
    try {
      await req.auth0.client.getTokenByExchangeProfile('<legacy-token>', {
        subjectTokenType: 'urn:acme:legacy-token',
        audience: 'https://api.example.com',
      });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as typeof error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).post('/test');

  expect(res.status).toBe(200);
  expect(error).toHaveProperty('code', 'token_exchange_error');
  expect(error?.cause?.error_description).toBe(
    'No token exchange profile matches subject_token_type urn:acme:legacy-token.'
  );
});

test('should reject a blank subject token before calling the tenant', async () => {
  // The token endpoint is not stubbed here on purpose. Reaching it would fail
  // the test, which is what proves the check is local.
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
  });

  let error: (Error & { code?: string; cause?: unknown }) | undefined;

  router.post('/test', async (req, res) => {
    try {
      await req.auth0.client.getTokenByExchangeProfile('   ', {
        subjectTokenType: 'urn:acme:legacy-token',
        audience: 'https://api.example.com',
      });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as typeof error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).post('/test');

  expect(res.status).toBe(200);
  expect(res.body.message).toContain('cannot be blank');
  expect(error).toHaveProperty('code', 'token_exchange_error');
  // Same code as a tenant rejection, so absent `cause` is what marks it local.
  expect(error?.cause).toBeUndefined();
});

test('should reject a blank organization before calling the tenant', async () => {
  // Token endpoint left unstubbed again, to prove this never goes out.
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
  });

  let error: (Error & { code?: string }) | undefined;

  router.post('/test', async (req, res) => {
    try {
      await req.auth0.client.getTokenByExchangeProfile('<legacy-token>', {
        subjectTokenType: 'urn:acme:legacy-token',
        audience: 'https://api.example.com',
        organization: '   ',
      });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as typeof error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).post('/test');

  expect(res.status).toBe(200);
  expect(res.body.message).toContain('must not be blank');
  expect(error).toHaveProperty('code', 'organization_validation_error');
});

test('should throw when the profile exchange returns an id token for another organization', async () => {
  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, async () => {
      return HttpResponse.json({
        access_token: '<auth0-token>',
        // Signed for this client, so it validates, but it names a different
        // organization than the one asked for below.
        id_token: await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, {
          org_id: 'org_somewhere_else',
        }),
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

  let error: (Error & { code?: string }) | undefined;

  router.post('/test', async (req, res) => {
    try {
      await req.auth0.client.getTokenByExchangeProfile('<legacy-token>', {
        subjectTokenType: 'urn:acme:legacy-token',
        audience: 'https://api.example.com',
        organization: 'org_abc123',
        scope: 'openid',
      });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as typeof error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).post('/test');

  expect(res.status).toBe(200);
  expect(error).toHaveProperty('code', 'organization_validation_error');
  expect(res.body.message).toContain('org_abc123');
  expect(res.body.message).toContain('org_somewhere_else');
});

test('should skip the organization check when the exchange returns no id token', async () => {
  // The documented trap, pinned. `auth0-auth-js` derives the claims it compares
  // from the ID token, so with none in the response there is nothing to compare
  // and the mismatch above goes unnoticed. If this test starts failing, the
  // upstream behaviour changed and the [!WARNING] in EXAMPLES.md is stale.
  server.use(
    http.post(mockOpenIdConfiguration.token_endpoint, async () => {
      return HttpResponse.json({
        access_token: '<auth0-token>',
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

  let error: Error | undefined;

  router.post('/test', async (req, res) => {
    try {
      const result = await req.auth0.client.getTokenByExchangeProfile('<legacy-token>', {
        subjectTokenType: 'urn:acme:legacy-token',
        audience: 'https://api.example.com',
        organization: 'org_abc123',
      });
      res.json(result);
    } catch (e) {
      error = e as Error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).post('/test');

  expect(res.status).toBe(200);
  expect(error).toBeUndefined();
  expect(res.body.accessToken).toBe('<auth0-token>');
  // No `idToken` came back, which is exactly why nothing was verified.
  expect(res.body.idToken).toBeUndefined();
});

test('should throw missing client auth for a profile exchange with a client id but no secret', async () => {
  // Mirrors the Token Vault test above. The table in EXAMPLES.md claims this
  // code for both credential shapes, so both should have a test.
  const app = express();
  app.use(express.json());

  const router = createAuth0Api({
    domain: domain,
    audience: '<audience>',
    clientId: '<client_id>',
  });

  let error: Error | undefined;

  router.post('/test', async (req, res) => {
    try {
      await req.auth0.client.getTokenByExchangeProfile('<legacy-token>', {
        subjectTokenType: 'urn:acme:legacy-token',
        audience: 'https://api.example.com',
      });
      res.json({ message: 'OK' });
    } catch (e) {
      error = e as Error;
      res.json({ message: (e as Error).message });
    }
  });

  app.use(router);

  const res = await request(app).post('/test');

  expect(res.status).toBe(200);
  expect(error).toBeInstanceOf(MissingClientAuthError);
  expect(error).toHaveProperty('code', 'missing_client_auth_error');
  expect(res.body.message).toContain('client secret or client assertion signing key must be provided');
});

// A token with exactly this header and payload, and a signature that never
// verifies, for rejections that come before the signature is checked.
const encodePart = (part: unknown) =>
  Buffer.from(typeof part === 'string' ? part : JSON.stringify(part)).toString('base64url');
const craftToken = (header: unknown, payload: unknown = { sub: 'user_123' }) =>
  `${encodePart(header)}.${encodePart(payload)}.${encodePart('<signature>')}`;

const nowInSeconds = () => Math.floor(Date.now() / 1000);

describe('the WWW-Authenticate header for a failed verification', () => {
  // What 1.0.0 sent, written out here so the comparison does not depend on the
  // code it checks.
  const asSentBy1_0_0 = (message: string) =>
    `Bearer error="invalid_token", error_description="${message.replaceAll('"', '\\"')}"`;

  const discoveryUri = `https://${domain}/.well-known/openid-configuration`;
  const jwksUri = `https://${domain}/.well-known/jwks.json`;

  const validToken = () => generateToken(domain, 'user_123', '<audience>');
  const validClaims = () => ({
    sub: 'user_123',
    aud: '<audience>',
    iss: `https://${domain}/`,
    iat: nowInSeconds(),
    exp: nowInSeconds() + 3600,
  });

  let otherKey: jose.GenerateKeyPairResult;

  beforeAll(async () => {
    otherKey = await jose.generateKeyPair('RS256');
  });

  // The reasons api-js, jose and oauth4webapi give for rejecting a token, each
  // driven for real through the route.
  const rejections: Array<{
    reason: string;
    token: () => string | Promise<string>;
    handlers?: () => HttpHandler[] | Promise<HttpHandler[]>;
    message: string;
  }> = [
    {
      reason: 'the wrong audience',
      token: () => generateToken(domain, 'user_123', '<invalid_audience>'),
      message: 'unexpected "aud" claim value',
    },
    {
      reason: 'no audience',
      token: () => generateToken(domain, 'user_123'),
      message: 'missing required "aud" claim',
    },
    {
      reason: 'the wrong issuer',
      token: () => generateToken(domain, 'user_123', '<audience>', 'https://invalid-issuer.local'),
      message: 'unexpected "iss" claim value',
    },
    {
      reason: 'no issuer',
      token: () => generateToken(domain, 'user_123', '<audience>', false),
      message: 'missing required "iss" claim',
    },
    {
      reason: 'an expired token',
      token: () =>
        generateToken(domain, 'user_123', '<audience>', undefined, nowInSeconds() - 7200, nowInSeconds() - 3600),
      message: '"exp" claim timestamp check failed',
    },
    {
      reason: 'a token that is not valid yet',
      token: () =>
        generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
          nbf: nowInSeconds() + 3600,
        }),
      message: '"nbf" claim timestamp check failed',
    },
    {
      reason: 'no exp',
      token: () => generateToken(domain, 'user_123', '<audience>', undefined, undefined, false),
      message: 'missing required "exp" claim',
    },
    {
      reason: 'no iat',
      token: () => generateToken(domain, 'user_123', '<audience>', undefined, false),
      message: 'missing required "iat" claim',
    },
    {
      reason: 'an exp that is not a number',
      token: () => generateToken(domain, 'user_123', '<audience>', undefined, undefined, false, { exp: 'tomorrow' }),
      message: '"exp" claim must be a number',
    },
    {
      reason: 'a DPoP-bound token sent as Bearer',
      token: () =>
        generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
          cnf: { jkt: '<thumbprint>' },
        }),
      message: 'DPoP-bound token requires the DPoP authentication scheme, not Bearer',
    },
    {
      reason: 'a symmetric algorithm',
      token: () => craftToken({ alg: 'HS256', typ: 'JWT' }, validClaims()),
      message: 'unsupported algorithm (symmetric algorithms are not supported)',
    },
    {
      reason: 'an algorithm that is not allowed',
      token: () => craftToken({ alg: 'PS256' }, validClaims()),
      message: '"alg" (Algorithm) Header Parameter value not allowed',
    },
    {
      reason: 'the none algorithm',
      token: () => craftToken({ alg: 'none' }, validClaims()),
      message: '"alg" (Algorithm) Header Parameter value not allowed',
    },
    {
      reason: 'no algorithm',
      token: () => craftToken({ typ: 'JWT' }, validClaims()),
      message: 'JWS "alg" (Algorithm) Header Parameter missing or invalid',
    },
    {
      reason: 'a signature from another key',
      token: () => new jose.SignJWT(validClaims()).setProtectedHeader({ alg: 'RS256' }).sign(otherKey.privateKey),
      message: 'signature verification failed',
    },
    {
      reason: 'a payload changed after signing',
      token: async () => {
        const [header, , signature] = (await validToken()).split('.');
        return `${header}.${encodePart({ ...validClaims(), sub: 'user_456' })}.${signature}`;
      },
      message: 'signature verification failed',
    },
    {
      reason: 'a signature that is not base64url',
      token: async () => `${(await validToken()).split('.').slice(0, 2).join('.')}.!!!`,
      message: 'Failed to base64url decode the signature',
    },
    {
      reason: 'a value that is not a JWT',
      token: () => 'not-a-jwt',
      message: 'Invalid Token or Protected Header formatting',
    },
    {
      reason: 'a JWE-shaped value',
      token: () => `${craftToken({ alg: 'RS256' })}.${encodePart('<tag>')}.${encodePart('<tag>')}`,
      message: 'Only JWTs using Compact JWS serialization can be decoded',
    },
    {
      reason: 'no payload',
      token: () => `${encodePart({ alg: 'RS256' })}..${encodePart('<signature>')}`,
      message: 'JWTs must contain a payload',
    },
    {
      reason: 'a payload that is not base64url',
      token: () => `${encodePart({ alg: 'RS256' })}.!!!.${encodePart('<signature>')}`,
      message: 'Failed to base64url decode the payload',
    },
    {
      reason: 'a payload that is not JSON',
      token: () => craftToken({ alg: 'RS256' }, 'not json'),
      message: 'Failed to parse the decoded payload as JSON',
    },
    {
      reason: 'a payload that is not an object',
      token: () => craftToken({ alg: 'RS256' }, []),
      message: 'Invalid JWT Claims Set',
    },
    {
      reason: 'a crit that is not an array',
      token: () => craftToken({ alg: 'RS256', crit: 'b64' }, validClaims()),
      message: '"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present',
    },
    {
      reason: 'a crit name that is not recognized',
      token: () => craftToken({ alg: 'RS256', crit: ['exp'] }, validClaims()),
      message: 'Extension Header Parameter "exp" is not recognized',
    },
    {
      reason: 'a crit b64 with no b64',
      token: () => craftToken({ alg: 'RS256', crit: ['b64'] }, validClaims()),
      message: 'Extension Header Parameter "b64" is missing',
    },
    {
      reason: 'a b64 that is not a boolean',
      token: () => craftToken({ alg: 'RS256', crit: ['b64'], b64: 'yes' }, validClaims()),
      message: 'The "b64" (base64url-encode payload) Header Parameter must be a boolean',
    },
    {
      reason: 'a kid with no key',
      token: () => craftToken({ alg: 'RS256', kid: '<unknown>' }, validClaims()),
      message: 'no applicable key found in the JSON Web Key Set',
    },
    {
      reason: 'more than one matching key',
      handlers: async () => {
        const otherJwk = await jose.exportJWK(otherKey.publicKey);
        return [http.get(jwksUri, () => HttpResponse.json({ keys: [...jwks, otherJwk] }))];
      },
      token: validToken,
      message: 'multiple matching keys found in the JSON Web Key Set',
    },
  ];

  // Failures that are not about the token. api-js gives them the same error as a bad token, so 1.0.0 answers them with
  // a 401 and the raw message. These tests record what is sent today, not what is right: an answer of 503, or a
  // message that is not echoed, should change them.
  const outages: typeof rejections = [
    {
      reason: 'a JWKS request that fails',
      handlers: () => [http.get(jwksUri, () => new HttpResponse(null, { status: 500 }))],
      token: validToken,
      message: 'JWKS request failed',
    },
    {
      reason: 'a JWKS endpoint that cannot be reached',
      handlers: () => [http.get(jwksUri, () => HttpResponse.error())],
      token: validToken,
      message: 'JWKS request failed',
    },
    {
      reason: 'a JWKS response that is not JSON',
      handlers: () => [http.get(jwksUri, () => HttpResponse.text('not json'))],
      token: validToken,
      message: 'Failed to parse the JSON Web Key Set HTTP response as JSON',
    },
    {
      reason: 'a malformed JWKS',
      handlers: () => [http.get(jwksUri, () => HttpResponse.json({}))],
      token: validToken,
      message: 'JSON Web Key Set malformed',
    },
    {
      reason: 'a discovery request that fails',
      handlers: () => [http.get(discoveryUri, () => new HttpResponse(null, { status: 500 }))],
      token: validToken,
      message: '"response" is not a conform Authorization Server Metadata response (unexpected HTTP status code)',
    },
    {
      reason: 'discovery metadata with no jwks_uri',
      handlers: () => [http.get(discoveryUri, () => HttpResponse.json({ issuer: `https://${domain}/` }))],
      token: validToken,
      message: 'missing "jwks_uri" in discovery metadata',
    },
    {
      reason: 'discovery metadata for another issuer',
      handlers: () => [
        http.get(discoveryUri, () =>
          HttpResponse.json({ ...mockOpenIdConfiguration, issuer: 'https://another.local/' })
        ),
      ],
      token: validToken,
      message: '"response" body "issuer" property does not match the expected value',
    },
  ];

  const expectWhatWasSentBy1_0_0 = async ({ token, handlers, message }: (typeof rejections)[number]) => {
    if (handlers) {
      server.use(...(await handlers()));
    }

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

    const res = await request(app)
      .get('/test')
      .set('authorization', `Bearer ${await token()}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_token', error_description: message });
    // Printable ASCII with no backslash, the text for which both must agree.
    expect(message).toMatch(/^[\x20-\x5b\x5d-\x7e]+$/);
    expect(res.headers['www-authenticate']).toBe(asSentBy1_0_0(message));
  };

  test.each(rejections)('should send what 1.0.0 sent for $reason', expectWhatWasSentBy1_0_0);

  describe('known 1.0.0 behaviour for failures that are not about the token', () => {
    test.each(outages)('should still send what 1.0.0 sent for $reason', expectWhatWasSentBy1_0_0);
  });
});

// 1.0.0 read the scopes of the token inside the `try` that answers a bad token, so a token whose `scope` claim is neither
// a string nor a list (Auth0 never issues one) was answered 401, and it must not become a 500 from the error handler.
test('should answer 401 invalid_token, and not call the error handler, for a token whose scope claim cannot be read', async () => {
  const app = express();
  const router = createAuth0Api({ domain: domain, audience: '<audience>' });
  router.get('/test', requiresAuth({ scopes: 'orders:read' }), (_req, res) => {
    res.json({ message: 'OK' });
  });
  app.use(router);
  const errors: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    errors.push(error);
    res.status(500).end();
  });
  const accessToken = await generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
    scope: 42,
  });

  const res = await request(app).get('/test').set('authorization', `Bearer ${accessToken}`);

  expect(errors).toEqual([]);
  expect(res.status).toBe(401);
  expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token", error_description="Invalid token"');
  expect(res.body).toEqual({ error: 'invalid_token', error_description: 'Invalid token' });
});

// What `parseChallenge()` gives for the `Bearer` challenge of an invalid token.
const challengeOf = (description: string) => ({
  scheme: 'Bearer',
  params: [
    ['error', 'invalid_token'],
    ['error_description', description],
  ],
});

// Node writes and reads header values as Latin-1, so comparing the strings
// compares the bytes.
describe('the answers that app-supplied text goes into', () => {
  const appWith = (...middleware: express.RequestHandler[]) => {
    const app = express();
    app.use(express.json());

    const router = createAuth0Api({
      domain: domain,
      audience: '<audience>',
    });

    router.get('/test', ...middleware, async (req, res) => {
      res.json({ message: 'OK' });
    });

    app.use(router);

    return app;
  };

  test('should keep the 403 from scopesInclude() with non-ASCII scope names', async () => {
    const accessToken = await generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
      scope: 'lire:messages',
    });

    const res = await request(appWith(requiresAuth(), scopesInclude('lire:messages écrire:messages')))
      .get('/test')
      .set('authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.headers['www-authenticate']).toBe(
      'Bearer error="insufficient_scope", error_description="Insufficient scopes", scope="lire:messages écrire:messages"'
    );
    expect(res.body).toEqual({ error: 'insufficient_scope', error_description: 'Insufficient scopes' });
  });

  test('should keep the 403 from requiresAuth() with non-ASCII scopes', async () => {
    const accessToken = await generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
      scope: 'lire:messages',
    });

    const res = await request(appWith(requiresAuth({ scopes: 'écrire:messages' })))
      .get('/test')
      .set('authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.headers['www-authenticate']).toBe(
      'Bearer error="insufficient_scope", error_description="Insufficient scopes"'
    );
    expect(res.body).toEqual({ error: 'insufficient_scope', error_description: 'Insufficient scopes' });
  });

  // The scopes are set by the developer, but they go into the header as text, so they are written like the other text:
  // escaped, and with a `?` for a character that Node refuses. A scope that is a valid scope-token (RFC 6749) is
  // unchanged.
  test.each([
    ['a double quote', 'read:"all"', 'read:"all"'],
    ['a backslash', 'read:a\\b', 'read:a\\b'],
    ['a character above U+00FF', 'read:\u20ac', 'read:?'],
    ['a character outside the BMP', 'read:\u{1F600}', 'read:?'],
  ])('should keep the 403 from scopesInclude() when a scope has %s, and write it as one quoted-string', async (_name, scope, written) => {
    const accessToken = await generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
      scope: 'other:scope',
    });

    const res = await request(appWith(requiresAuth(), scopesInclude(scope)))
      .get('/test')
      .set('authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(parseChallenge(res.headers['www-authenticate']!)).toEqual({
      scheme: 'Bearer',
      params: [
        ['error', 'insufficient_scope'],
        ['error_description', 'Insufficient scopes'],
        ['scope', written],
      ],
    });
    expect(res.body).toEqual({ error: 'insufficient_scope', error_description: 'Insufficient scopes' });
  });

  // Latin-1 text stays as it was. `\` is escaped now (1.0.0 sent it as it was, which dropped it or left the string open),
  // so the header decodes to the same text as the JSON body.
  const errorMessage = 'Réservé aux "administrateurs" (voir C:\\équipe)';

  const middlewares = (message: string) =>
    [
      ['claimEquals()', claimEquals('rôle', 'administrateur', { errorMessage: message })],
      ['claimIncludes()', claimIncludes('rôles', ['administrateur'], { errorMessage: message })],
      ['claimCheck()', claimCheck(() => false, { errorMessage: message })],
    ] as const;

  const lecteur = () =>
    generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
      rôle: 'lecteur',
      rôles: ['lecteur'],
    });

  test.each(middlewares(errorMessage))(
    'should keep the 401 from %s with a Latin-1 error message, and escape its backslash',
    async (_name, middleware) => {
      const res = await request(appWith(requiresAuth(), middleware))
        .get('/test')
        .set('authorization', `Bearer ${await lecteur()}`);

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe(
        'Bearer error="invalid_token", error_description="Réservé aux \\"administrateurs\\" (voir C:\\\\équipe)"'
      );
      expect(parseChallenge(res.headers['www-authenticate']!)).toEqual(challengeOf(errorMessage));
      expect(res.body).toEqual({ error: 'invalid_token', error_description: errorMessage });
    }
  );

  // Node refuses a character above U+00FF in a header value, so the header gets a `?` and the JSON body keeps the text.
  test.each([
    ['a trailing backslash', 'Admins only \\', 'Admins only \\'],
    ['a character above U+00FF', '管理者のみ', '?????'],
    ['a character outside the BMP', 'Admins \u{1F600}', 'Admins ?'],
    ['a euro sign', 'costs \u20ac5', 'costs ?5'],
    ['a carriage return and a line feed', 'one\r\ntwo', 'one??two'],
  ])('should send a 401 with a header that parses for an error message with %s', async (_label, message, decoded) => {
    const res = await request(appWith(requiresAuth(), claimEquals('rôle', 'administrateur', { errorMessage: message })))
      .get('/test')
      .set('authorization', `Bearer ${await lecteur()}`);

    expect(res.status).toBe(401);
    expect(parseChallenge(res.headers['www-authenticate']!)).toEqual(challengeOf(decoded));
    expect(res.body).toEqual({ error: 'invalid_token', error_description: message });
  });

  test.each(middlewares('管理者のみ \\'))(
    'should send a 401 with a header that parses from %s for text above U+00FF and a trailing backslash',
    async (_name, middleware) => {
      const res = await request(appWith(requiresAuth(), middleware))
        .get('/test')
        .set('authorization', `Bearer ${await lecteur()}`);

      expect(res.status).toBe(401);
      expect(parseChallenge(res.headers['www-authenticate']!)).toEqual(challengeOf('????? \\'));
      expect(res.body).toEqual({ error: 'invalid_token', error_description: '管理者のみ \\' });
    }
  );

  test('should keep the 401 from claimEquals() with a default message naming a non-ASCII claim', async () => {
    const accessToken = await generateToken(domain, 'user_123', '<audience>', undefined, undefined, undefined, {
      rôle: 'lecteur',
    });

    const res = await request(appWith(requiresAuth(), claimEquals('rôle', 'administrateur')))
      .get('/test')
      .set('authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer error="invalid_token", error_description="Unexpected 'rôle' value"`
    );
    expect(res.body).toEqual({ error: 'invalid_token', error_description: "Unexpected 'rôle' value" });
  });
});

describe('in a router mounted on a path', () => {
  const mountedApp = (...before: express.RequestHandler[]) => {
    const app = express();
    const api = express.Router();

    api.use(createAuth0Api({ domain: domain, audience: '<audience>' }));
    api.get('/me', ...before, requiresAuth(), async (req, res) => {
      res.json({ sub: req.auth0.user?.sub });
    });
    app.use('/api', api);

    const errors: Array<Error & { code?: string }> = [];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      errors.push(error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });

    return { app, errors };
  };

  test('should answer with a header that parses when the message holds text from the token', async () => {
    const { app, errors } = mountedApp();
    // jose names an unrecognized `crit` entry in its message, and checks it
    // before the signature, so anyone can choose this text.
    const name = 'x"y\\z\r\nX-Injected: yes \u20ac';

    const res = await request(app)
      .get('/api/me')
      .set('authorization', `Bearer ${craftToken({ alg: 'RS256', crit: [name] })}`);

    expect(errors).toEqual([]);
    expect(res.status).toBe(401);
    expect(res.headers['x-injected']).toBeUndefined();
    expect(parseChallenge(res.headers['www-authenticate']!)).toEqual({
      scheme: 'Bearer',
      params: [
        ['error', 'invalid_token'],
        ['error_description', 'Extension Header Parameter "x"y\\z??X-Injected: yes ?" is not recognized'],
      ],
    });
    expect(res.body).toEqual({
      error: 'invalid_token',
      error_description: `Extension Header Parameter "${name}" is not recognized`,
    });
  });

  test('should cut the text from the token in the header, and not in the body', async () => {
    const { app, errors } = mountedApp();
    // The message starts with 28 characters (`Extension Header Parameter "`), so the backslash is the 256th character,
    // the last one that the header keeps. It has to be escaped as a whole, or the header does not parse.
    const name = `${'x'.repeat(227)}\\${'y'.repeat(100)}`;
    const message = `Extension Header Parameter "${name}" is not recognized`;

    const res = await request(app)
      .get('/api/me')
      .set('authorization', `Bearer ${craftToken({ alg: 'RS256', crit: [name] })}`);

    expect(errors).toEqual([]);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']!.length).toBeLessThan(600);
    expect(parseChallenge(res.headers['www-authenticate']!)).toEqual(challengeOf(message.slice(0, 256)));
    expect(res.body).toEqual({ error: 'invalid_token', error_description: message });
  });

  // This fails against the 1.0.0 source on Express 4 only. On Express 5 it passes either way, so it guards the
  // process exit when the tests run on Express 4 (the `Express 4` job of `.github/workflows/test.yml`).
  test('should pass an error thrown while answering to the app error handler', async () => {
    // Stands in for a middleware, such as a timeout, that answered first.
    const { app, errors } = mountedApp((req, res, next) => {
      res.status(503).end();
      next();
    });

    const res = await request(app)
      .get('/api/me')
      .set('authorization', `Bearer ${await generateToken(domain, 'user_123', '<invalid_audience>')}`);

    expect(res.status).toBe(503);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]?.code).toBe('ERR_HTTP_HEADERS_SENT');
  });
});

// What a hostile client can put into the header of a JWT. jose checks `crit` before the signature, and its message holds
// the client's own text, so a CR and an LF reach the message of the error without any key or valid token.
function hostileToken(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = { alg: 'RS256', typ: 'JWT', crit: ['x\r\nSet-Cookie: a=b'], 'x\r\nSet-Cookie: a=b': true };
  return `${encode(header)}.${encode({ iss: `https://${domain}/`, aud: '<audience>' })}.c2ln`;
}

test('should answer 401, and not crash, for a JWT whose header holds a CR and an LF', async () => {
  // On Express 4 a rejected handler promise ends the process, and `res.header` throws for a control character.
  const app = express();
  const router = createAuth0Api({ domain: domain, audience: '<audience>' });
  router.get('/test', requiresAuth(), (_req, res) => {
    res.json({ message: 'OK' });
  });
  app.use(router);

  const res = await request(app).get('/test').set('authorization', `Bearer ${hostileToken()}`);

  expect(res.status).toBe(401);
  expect(res.headers['set-cookie']).toBeUndefined();
  expect(res.headers['www-authenticate']).toMatch(/^Bearer error="invalid_token", error_description="[\x20-\x7e]*"$/);
  expect(res.body.error).toBe('invalid_token');
});

test('should name only the Bearer scheme in the challenges of a router without poppy', async () => {
  // A router without poppy does not accept DPoP, so its errors must not offer it.
  const app = express();
  const router = createAuth0Api({ domain: domain, audience: '<audience>' });
  router.get('/scopes', requiresAuth(), scopesInclude('orders:write'), (_req, res) => {
    res.json({ message: 'OK' });
  });
  router.get('/claim', requiresAuth(), claimEquals('tier', 'gold'), (_req, res) => {
    res.json({ message: 'OK' });
  });
  app.use(router);
  const accessToken = await generateToken(domain, 'user_123', '<audience>');

  const scopes = await request(app).get('/scopes').set('authorization', `Bearer ${accessToken}`);
  const claim = await request(app).get('/claim').set('authorization', `Bearer ${accessToken}`);

  expect(scopes.status).toBe(403);
  expect(scopes.headers['www-authenticate']).toBe(
    'Bearer error="insufficient_scope", error_description="Insufficient scopes", scope="orders:write"'
  );
  expect(claim.status).toBe(401);
  expect(claim.headers['www-authenticate']).toBe(
    'Bearer error="invalid_token", error_description="Missing \'tier\' claim"'
  );
});
