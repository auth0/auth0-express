/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { scopesInclude } from './scopes-include.js';

describe('scopesInclude', () => {
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockNext = vi.fn();
  });

  const createMockRequest = (user: any): Partial<Request> => ({
    auth0: { user },
  });

  const createMockResponse = (): Partial<Response> => {
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return res;
  };

  describe('match: "any" (default)', () => {
    it('should call next() when token has one of the required scopes (string)', () => {
      const middleware = scopesInclude('read:msg write:msg');
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'read:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next() when token has one of the required scopes (array)', () => {
      const middleware = scopesInclude(['read:msg', 'write:msg']);
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'write:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next() when token has multiple matching scopes', () => {
      const middleware = scopesInclude('read:msg write:msg');
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'read:msg write:msg delete:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next() with explicit match: "any"', () => {
      const middleware = scopesInclude('read:msg write:msg', { match: 'any' });
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'read:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 403 when token has none of the required scopes', () => {
      const middleware = scopesInclude('read:msg write:msg');
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'delete:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.header).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('error="insufficient_scope"')
      );
      expect(res.header).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('scope="read:msg write:msg"')
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('match: "all"', () => {
    it('should call next() when token has all required scopes', () => {
      const middleware = scopesInclude('read:msg write:msg', { match: 'all' });
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'read:msg write:msg delete:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next() when token has exactly all required scopes', () => {
      const middleware = scopesInclude(['read:msg', 'write:msg'], { match: 'all' });
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'read:msg write:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 403 when token has only some of the required scopes', () => {
      const middleware = scopesInclude('read:msg write:msg', { match: 'all' });
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'read:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'insufficient_scope',
        error_description: 'Insufficient scopes',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 when token has none of the required scopes', () => {
      const middleware = scopesInclude('read:msg write:msg', { match: 'all' });
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'delete:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('common behavior', () => {
    it('should return 403 when scope claim is missing', () => {
      const middleware = scopesInclude('read:msg');
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 when no token is present', () => {
      const middleware = scopesInclude('read:msg');
      const req = { auth0: {} } as Partial<Request>;
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should throw TypeError when scopes is not a string or array', () => {
      expect(() => scopesInclude(123 as any)).toThrow(TypeError);
      expect(() => scopesInclude(123 as any)).toThrow("'scopes' must be a string or array of strings");
    });

    it('should throw Error when scopes is empty string', () => {
      expect(() => scopesInclude('')).toThrow(Error);
      expect(() => scopesInclude('')).toThrow("'scopes' must contain at least one scope");
    });

    it('should throw Error when scopes array is empty', () => {
      expect(() => scopesInclude([])).toThrow(Error);
      expect(() => scopesInclude([])).toThrow("'scopes' must contain at least one scope");
    });

    it('should handle single scope requirement', () => {
      const middleware = scopesInclude('read:msg');
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'read:msg write:msg',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle array scope claim', () => {
      const middleware = scopesInclude('read:msg write:msg');
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: ['read:msg', 'delete:msg'],
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should be case-sensitive with scopes', () => {
      const middleware = scopesInclude('read:msg');
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: 'READ:MSG',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle empty scope claim', () => {
      const middleware = scopesInclude('read:msg');
      const req = createMockRequest({
        sub: 'user123',
        aud: 'api',
        iss: 'issuer',
        scope: '',
      });
      const res = createMockResponse();

      middleware(req as Request, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
