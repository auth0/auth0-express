import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { requireAuth } from './require-auth.js';
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

describe('requireAuth middleware', () => {
  test('redirects to login when not authenticated', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/protected', requireAuth(), (req, res) => {
      res.send('Protected content');
    });

    const res = await request(app).get('/protected');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/login');
    expect(res.headers.location).toContain('returnTo=%2Fprotected');
  });

  test('redirects to custom login when not authenticated', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
      routes: {
        login: '/custom-login',
      }
    });

    app.get('/protected', requireAuth(), (req, res) => {
      res.send('Protected content');
    });

    const res = await request(app).get('/protected');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/custom-login');
    expect(res.headers.location).toContain('returnTo=%2Fprotected');
  });

  test('preserves query string in returnTo', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/protected', requireAuth(), (req, res) => {
      res.send('Protected content');
    });

    const res = await request(app).get('/protected?foo=bar&baz=qux');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/login');
    expect(res.headers.location).toContain(encodeURIComponent('/protected?foo=bar&baz=qux'));
  });

  test('returns 401 for API requests when not authenticated', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/api/data', requireAuth(), (req, res) => {
      res.json({ data: 'test' });
    });

    const res = await request(app).get('/api/data').set('Accept', 'application/json');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
    expect(res.body.message).toBe('Authentication required');
  });

  test('supports custom returnTo option', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/admin', requireAuth({ returnTo: '/admin/dashboard' }), (req, res) => {
      res.send('Admin content');
    });

    const res = await request(app).get('/admin');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('returnTo=%2Fadmin%2Fdashboard');
  });

  test('allows authenticated users to access protected routes', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/protected', requireAuth(), async (req, res) => {
      const user = await req.auth0.client.getUser();
      res.json({ user });
    });

    const sessionCookie = await authenticateUser(app);
    const res = await request(app).get('/protected').set('cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.sub).toBe('user_123');
  });

  test('handles errors in getUser', async () => {
    const app = createConfiguredApp({
      domain: 'auth0.local',
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: '<secret>',
    });

    app.get('/protected', requireAuth(), (req, res) => {
      res.send('Protected content');
    });

    // Add error handler to verify error is passed to next
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      res.status(500).json({ error: err.message });
      next();
    });

    // Send malformed session cookie to trigger error
    const res = await request(app).get('/protected').set('cookie', '__a0_session=invalid_data');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.error).toBe('Invalid Compact JWE'); // temporarily until resolved in auth0-server-js
  });
});
