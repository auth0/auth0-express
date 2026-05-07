import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { requireAuth } from './require-auth.js';
import { claimIncludes } from './claim-includes.js';
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

describe('claimIncludes middleware', () => {
  test('allows access when claim includes required value', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.delete('/users/:id', requireAuth(), claimIncludes('permissions', ['delete:users']), (req, res) => {
      res.json({ success: true });
    });

    const sessionCookie = await authenticateUser(app, {
      permissions: ['read:users', 'delete:users', 'update:users'],
    });
    const res = await request(app).delete('/users/123').set('cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('denies access when claim does not include required value', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.delete('/users/:id', requireAuth(), claimIncludes('permissions', ['delete:users']), (req, res) => {
      res.json({ success: true });
    });

    const sessionCookie = await authenticateUser(app, {
      permissions: ['read:users', 'update:users'],
    });
    const res = await request(app).delete('/users/123').set('cookie', sessionCookie);

    expect(res.status).toBe(403);
  });

  test('allows access when claim includes all required values', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/admin', requireAuth(), claimIncludes('permissions', ['read:users', 'delete:users']), (req, res) => {
      res.send('Admin page');
    });

    const sessionCookie = await authenticateUser(app, {
      permissions: ['read:users', 'delete:users', 'update:users'],
    });
    const res = await request(app).get('/admin').set('cookie', sessionCookie);

    expect(res.status).toBe(200);
  });

  test('denies access when claim is not an array', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/admin', requireAuth(), claimIncludes('permissions', ['delete:users']), (req, res) => {
      res.send('Admin page');
    });

    const sessionCookie = await authenticateUser(app, {
      permissions: 'delete:users', // Not an array
    });
    const res = await request(app).get('/admin').set('cookie', sessionCookie);

    expect(res.status).toBe(403);
  });

  test('denies access when claim is missing', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/admin', requireAuth(), claimIncludes('permissions', ['delete:users']), (req, res) => {
      res.send('Admin page');
    });

    const sessionCookie = await authenticateUser(app, {});
    const res = await request(app).get('/admin').set('cookie', sessionCookie);

    expect(res.status).toBe(403);
  });

  test('handles errors in getUser for requests that accept JSON', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/admin', requireAuth(), claimIncludes('permissions', ['delete:users']), (req, res) => {
      res.send('Admin page');
    });

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

    app.get('/admin', requireAuth(), claimIncludes('permissions', ['delete:users']), (req, res) => {
      res.send('Admin page');
    });

    // Send malformed session cookie to trigger error
    const res = await request(app).get('/admin').set('Accept', 'text/html').set('cookie', '__a0_session=invalid_data');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('returnTo=');
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
      '/admin',
      requireAuth(),
      claimIncludes('permissions', ['delete:users'], { statusCode: 402, errorMessage: 'Custom error message' }),
      (req, res) => {
        res.send('Admin page');
      }
    );

    const sessionCookie = await authenticateUser(app, {});
    const res = await request(app).get('/admin').set('cookie', sessionCookie);

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('forbidden');
    expect(res.body.message).toBe('Custom error message');
  });
});
