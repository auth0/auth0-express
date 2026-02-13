/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextFunction, Request, Response } from 'express';
import { claimCheck } from './claim-check.js';

describe('claimCheck', () => {
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

  it('should call next() when validation function returns true', () => {
    const middleware = claimCheck((token) => token.sub === 'user123');
    const req = createMockRequest({ sub: 'user123', aud: 'api', iss: 'issuer' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should call next() with complex validation logic', () => {
    const middleware = claimCheck(
      (token: any) => token.isAdmin === true && token.roles?.includes('editor')
    );
    const req = createMockRequest({
      sub: 'user123',
      aud: 'api',
      iss: 'issuer',
      isAdmin: true,
      roles: ['editor', 'viewer']
    });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should return 401 when validation function returns false', () => {
    const middleware = claimCheck((token) => token.sub === 'admin123');
    const req = createMockRequest({ sub: 'user123', aud: 'api', iss: 'issuer' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: 'Invalid token claims',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should use custom error message with options object', () => {
    const middleware = claimCheck(
      (token) => token.sub === 'admin123',
      { errorMessage: 'Administrator access required' }
    );
    const req = createMockRequest({ sub: 'user123', aud: 'api', iss: 'issuer' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: 'Administrator access required',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when validation function throws error', () => {
    const middleware = claimCheck(() => {
      throw new Error('Validation failed');
    });
    const req = createMockRequest({ sub: 'user123', aud: 'api', iss: 'issuer' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: 'Invalid token claims',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when no token is present', () => {
    const middleware = claimCheck(() => true);
    const req = { auth0: {} } as Partial<Request>;
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: 'No token found',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should throw TypeError when fn is not a function', () => {
    expect(() => claimCheck('not a function' as any)).toThrow(TypeError);
    expect(() => claimCheck('not a function' as any)).toThrow("'fn' must be a function");
  });

  it('should receive full token payload', () => {
    const validationFn = vi.fn().mockReturnValue(true);
    const middleware = claimCheck(validationFn);
    const token = {
      sub: 'user123',
      aud: 'api',
      iss: 'issuer',
      custom: 'value'
    };
    const req = createMockRequest(token);
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(validationFn).toHaveBeenCalledWith(token);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle undefined/null return values as false', () => {
    const middleware = claimCheck(() => undefined as any);
    const req = createMockRequest({ sub: 'user123', aud: 'api', iss: 'issuer' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
