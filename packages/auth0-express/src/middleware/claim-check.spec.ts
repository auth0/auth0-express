import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { requireAuth } from './require-auth.js';
import { claimCheck } from './claim-check.js';
import {
  server,
  setupTests,
  resetMockConfig,
  createConfiguredApp,
  authenticateUser,
} from '../test-utils/test-setup.js';

beforeAll(() =>
  server.listen({
    onUnhandledRequest: 'bypass',
  })
);

afterAll(() => server.close());

beforeEach(async () => {
  await setupTests();
});

afterEach(() => {
  resetMockConfig();
  server.resetHandlers();
});

describe('claimCheck middleware', () => {
  test('allows access when validation function returns true', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get(
      '/premium',
      requireAuth(),
      claimCheck((claims) => claims.subscription === 'premium' && claims.email_verified === true),
      (req, res) => {
        res.send('Premium content');
      }
    );

    const sessionCookie = await authenticateUser(app, {
      subscription: 'premium',
      email_verified: true,
    });
    const res = await request(app).get('/premium').set('cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.text).toBe('Premium content');
  });

  test('denies access when validation function returns false', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get(
      '/premium',
      requireAuth(),
      claimCheck((claims) => claims.subscription === 'premium'),
      (req, res) => {
        res.send('Premium content');
      }
    );

    const sessionCookie = await authenticateUser(app, {
      subscription: 'free',
    });
    const res = await request(app).get('/premium').set('cookie', sessionCookie);

    expect(res.status).toBe(403);
  });

  test('allows access with specific claim value', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get(
      '/org/settings',
      requireAuth(),
      claimCheck((claims) => {
        return claims.org_id === 'org_123';
      }),
      (req, res) => {
        res.send('Org settings');
      }
    );

    const sessionCookie = await authenticateUser(app, {
      org_id: 'org_123',
    });
    const res = await request(app).get('/org/settings').set('cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.text).toBe('Org settings');
  });

  test('denies access when claim value does not match', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get(
      '/org/settings',
      requireAuth(),
      claimCheck((claims) => {
        return claims.org_id === 'org_123';
      }),
      (req, res) => {
        res.send('Org settings');
      }
    );

    const sessionCookie = await authenticateUser(app, {
      org_id: 'org_456',
    });
    const res = await request(app).get('/org/settings').set('cookie', sessionCookie);

    expect(res.status).toBe(403);
  });

  test('supports complex validation logic', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get(
      '/admin',
      requireAuth(),
      claimCheck((claims) => {
        // Complex logic: admin role OR owner with verified email
        return claims.role === 'admin' || (claims.role === 'owner' && claims.email_verified === true);
      }),
      (req, res) => {
        res.send('Admin page');
      }
    );

    // Test with admin role
    let sessionCookie = await authenticateUser(app, { role: 'admin' });
    let res = await request(app).get('/admin').set('cookie', sessionCookie);
    expect(res.status).toBe(200);

    // Test with owner + verified email
    sessionCookie = await authenticateUser(app, { role: 'owner', email_verified: true });
    res = await request(app).get('/admin').set('cookie', sessionCookie);
    expect(res.status).toBe(200);

    // Test with owner but unverified email
    sessionCookie = await authenticateUser(app, { role: 'owner', email_verified: false });
    res = await request(app).get('/admin').set('cookie', sessionCookie);
    expect(res.status).toBe(403);
  });

  test('supports custom status code and error message', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get(
      '/beta',
      requireAuth(),
      claimCheck((claims) => claims.beta_access === true, {
        statusCode: 402,
        errorMessage: 'Beta access required',
      }),
      (req, res) => {
        res.send('Beta features');
      }
    );

    const sessionCookie = await authenticateUser(app, { beta_access: false });
    const res = await request(app).get('/beta').set('cookie', sessionCookie);

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('forbidden');
    expect(res.body.message).toBe('Beta access required');
  });

  test('handles errors in getUser for requests that accept JSON', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get(
      '/admin',
      requireAuth(),
      claimCheck((claims) => claims.role === 'admin'),
      (req, res) => {
        res.send('Admin page');
      }
    );

    // Send malformed session cookie to trigger error
    const res = await request(app)
      .get('/admin')
      .set('Accept', 'application/json')
      .set('cookie', '__a0_session=invalid_data');

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error).toBe('unauthorized');
  });

  test('handles errors in getUser for requests that accept HTML', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get(
      '/admin',
      requireAuth(),
      claimCheck((claims) => claims.role === 'admin'),
      (req, res) => {
        res.send('Admin page');
      }
    );

    // Send malformed session cookie to trigger error
    const res = await request(app)
      .get('/admin')
      .set('Accept', 'text/html')
      .set('cookie', '__a0_session=invalid_data');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('returnTo=');
  });
});
