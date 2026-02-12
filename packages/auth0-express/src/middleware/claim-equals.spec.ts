import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { requireAuth } from './require-auth.js';
import { claimEquals } from './claim-equals.js';
import {
  server,
  setupTests,
  resetMockConfig,
  createConfiguredApp,
  authenticateUser,
} from '../test-helpers/test-setup.js';

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

describe('claimEquals middleware', () => {
  test('allows access when claim matches expected value', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/admin', requireAuth(), claimEquals('role', 'admin'), (req, res) => {
      res.send('Admin page');
    });

    const sessionCookie = await authenticateUser(app, { role: 'admin' });
    const res = await request(app).get('/admin').set('cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.text).toBe('Admin page');
  });

  test('denies access when claim does not match', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/admin', requireAuth(), claimEquals('role', 'admin'), (req, res) => {
      res.send('Admin page');
    });

    const sessionCookie = await authenticateUser(app, { role: 'user' });
    const res = await request(app).get('/admin').set('cookie', sessionCookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  test('denies access when claim is missing', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/admin', requireAuth(), claimEquals('role', 'admin'), (req, res) => {
      res.send('Admin page');
    });

    const sessionCookie = await authenticateUser(app, {});
    const res = await request(app).get('/admin').set('cookie', sessionCookie);

    expect(res.status).toBe(403);
  });

  test('supports namespaced claims', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get(
      '/internal',
      requireAuth(),
      claimEquals('https://myapp.com/department', 'engineering'),
      (req, res) => {
        res.send('Engineering portal');
      }
    );

    const sessionCookie = await authenticateUser(app, { 'https://myapp.com/department': 'engineering' });
    const res = await request(app).get('/internal').set('cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.text).toBe('Engineering portal');
  });

  test('returns 403 with JSON for API requests', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/api/admin', requireAuth(), claimEquals('role', 'admin'), (req, res) => {
      res.json({ success: true });
    });

    const sessionCookie = await authenticateUser(app, { role: 'user' });
    const res = await request(app).get('/api/admin').set('cookie', sessionCookie).set('Accept', 'application/json');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect(res.body.message).toBeDefined();
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
      '/premium',
      requireAuth(),
      claimEquals('subscription', 'premium', {
        statusCode: 402,
        errorMessage: 'Premium subscription required',
      }),
      (req, res) => {
        res.send('Premium content');
      }
    );

    const sessionCookie = await authenticateUser(app, { subscription: 'free' });
    const res = await request(app).get('/premium').set('cookie', sessionCookie);

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('forbidden');
    expect(res.body.message).toBe('Premium subscription required');
  });

  test('handles errors in getUser', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/admin', requireAuth(), claimEquals('role', 'admin'), (req, res) => {
      res.send('Admin page');
    });

    // Add error handler
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      res.status(500).json({ error: err.message });
      next();
    });

    // Send malformed session cookie to trigger error
    const res = await request(app).get('/admin').set('cookie', '__a0_session=invalid_data');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.error).toBe('Invalid Compact JWE'); // temporarily until resolved in auth0-server-js
  });
});
