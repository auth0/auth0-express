import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextFunction, Request, Response } from 'express';
import type { ApiClient } from '@auth0/auth0-api-js';
import { requiresAuth } from './require-auth.js';

describe('requiresAuth', () => {
  let mockNext: ReturnType<typeof vi.fn>;
  let verifyAccessToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockNext = vi.fn();
    verifyAccessToken = vi.fn();
  });

  const createMockClient = () => ({ verifyAccessToken }) as unknown as ApiClient;

  const createMockRequest = (
    authorization?: string,
    client: ApiClient | undefined = createMockClient()
  ): Partial<Request> => ({
    headers: authorization ? { authorization } : {},
    // Cast because the router, not the caller, supplies the rest of `req.auth0`.
    auth0: { client } as Request['auth0'],
  });

  const createMockResponse = (): Partial<Response> => ({
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  });

  it('should throw when the Auth0 router is not registered', async () => {
    const req = { headers: {}, auth0: {} as Request['auth0'] } as Partial<Request>;

    await expect(
      requiresAuth()(req as Request, createMockResponse() as Response, mockNext as NextFunction)
    ).rejects.toThrow('Auth0 ApiClient not found on request');
  });

  it('should return 401 with a bare Bearer challenge when no token is present', async () => {
    const req = createMockRequest();
    const res = createMockResponse();

    await requiresAuth()(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['a scheme with no credentials', 'Bearer'],
    ['more parts than expected', 'Bearer token extra'],
  ])('should return 401 for %s', async (_label, authorization) => {
    const req = createMockRequest(authorization);
    const res = createMockResponse();

    await requiresAuth()(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    // Same path as no header at all, so the challenge has to come back too.
    // Without it a client has nothing telling it which scheme to retry with.
    expect(res.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should accept a lowercase bearer scheme', async () => {
    verifyAccessToken.mockResolvedValue({ sub: 'user_123' });
    const req = createMockRequest('bearer <token>');

    await requiresAuth()(req as Request, createMockResponse() as Response, mockNext as NextFunction);

    expect(verifyAccessToken).toHaveBeenCalledWith({ accessToken: '<token>' });
    expect(mockNext).toHaveBeenCalled();
  });

  describe('on a verified request', () => {
    const claims = { sub: 'user_123', aud: 'urn:api', iss: 'https://auth0.local/' };

    it('should populate both the verified claims and the raw token', async () => {
      verifyAccessToken.mockResolvedValue(claims);
      const req = createMockRequest('Bearer <token>');

      await requiresAuth()(req as Request, createMockResponse() as Response, mockNext as NextFunction);

      expect(req.auth0!.user).toEqual(claims);
      expect(req.auth0!.token).toBe('<token>');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should keep the raw token out of anything that enumerates req.auth0', async () => {
      verifyAccessToken.mockResolvedValue(claims);
      const req = createMockRequest('Bearer <token>');

      await requiresAuth()(req as Request, createMockResponse() as Response, mockNext as NextFunction);

      expect(JSON.stringify(req.auth0)).not.toContain('<token>');
      expect({ ...req.auth0 }).not.toHaveProperty('token');
      expect(Object.keys(req.auth0!)).not.toContain('token');
    });

    it('should keep the client attached by the router', async () => {
      verifyAccessToken.mockResolvedValue(claims);
      const client = createMockClient();
      const req = createMockRequest('Bearer <token>', client);

      await requiresAuth()(req as Request, createMockResponse() as Response, mockNext as NextFunction);

      expect(req.auth0!.client).toBe(client);
    });
  });

  describe('scopes', () => {
    it.each([
      ['a single required scope', 'read:messages', 'read:messages write:messages'],
      ['every required scope', ['read:messages', 'write:messages'], 'read:messages write:messages'],
    ])('should call next() when the token has %s', async (_label, required, scope) => {
      verifyAccessToken.mockResolvedValue({ sub: 'user_123', scope });
      const req = createMockRequest('Bearer <token>');

      await requiresAuth({ scopes: required })(
        req as Request,
        createMockResponse() as Response,
        mockNext as NextFunction
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should accept a scope claim that is already an array', async () => {
      verifyAccessToken.mockResolvedValue({ sub: 'user_123', scope: ['read:messages'] });
      const req = createMockRequest('Bearer <token>');

      await requiresAuth({ scopes: 'read:messages' })(
        req as Request,
        createMockResponse() as Response,
        mockNext as NextFunction
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 403 insufficient_scope when a required scope is missing', async () => {
      verifyAccessToken.mockResolvedValue({ sub: 'user_123', scope: 'read:messages' });
      const req = createMockRequest('Bearer <token>');
      const res = createMockResponse();

      await requiresAuth({ scopes: ['read:messages', 'write:messages'] })(
        req as Request,
        res as Response,
        mockNext as NextFunction
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'insufficient_scope',
        error_description: 'Insufficient scopes',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 when the token carries no scope claim at all', async () => {
      verifyAccessToken.mockResolvedValue({ sub: 'user_123' });
      const req = createMockRequest('Bearer <token>');
      const res = createMockResponse();

      await requiresAuth({ scopes: 'read:messages' })(
        req as Request,
        res as Response,
        mockNext as NextFunction
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should not expose the raw token when the scope check fails', async () => {
      verifyAccessToken.mockResolvedValue({ sub: 'user_123', scope: 'read:messages' });
      const req = createMockRequest('Bearer <token>');

      await requiresAuth({ scopes: 'write:messages' })(
        req as Request,
        createMockResponse() as Response,
        mockNext as NextFunction
      );

      expect(req.auth0!.token).toBeUndefined();
      expect(req.auth0!.user).toBeUndefined();
    });
  });

  describe('when verification fails', () => {
    it('should surface the reason for a verify_access_token_error', async () => {
      verifyAccessToken.mockRejectedValue(
        Object.assign(new Error('"exp" claim timestamp check failed'), {
          code: 'verify_access_token_error',
        })
      );
      const req = createMockRequest('Bearer <token>');
      const res = createMockResponse();

      await requiresAuth()(req as Request, res as Response, mockNext as NextFunction);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description: '"exp" claim timestamp check failed',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should fall back to a generic reason for any other error', async () => {
      verifyAccessToken.mockRejectedValue(new Error('socket hang up'));
      const req = createMockRequest('Bearer <token>');
      const res = createMockResponse();

      await requiresAuth()(req as Request, res as Response, mockNext as NextFunction);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description: 'Invalid token',
      });
    });

    it('should not expose the raw token', async () => {
      verifyAccessToken.mockRejectedValue(new Error('socket hang up'));
      const req = createMockRequest('Bearer <token>');

      await requiresAuth()(req as Request, createMockResponse() as Response, mockNext as NextFunction);

      expect(req.auth0!.token).toBeUndefined();
      expect(req.auth0!.user).toBeUndefined();
    });
  });
});
