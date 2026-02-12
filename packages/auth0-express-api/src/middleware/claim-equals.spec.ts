/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextFunction, Request, Response } from 'express';
import { claimEquals } from './claim-equals.js';

describe('claimEquals', () => {
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

  it('should call next() when claim equals expected value (string)', () => {
    const middleware = claimEquals('role', 'admin');
    const req = createMockRequest({ role: 'admin' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should call next() when claim equals expected value (number)', () => {
    const middleware = claimEquals('level', 5);
    const req = createMockRequest({ level: 5 });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should call next() when claim equals expected value (boolean)', () => {
    const middleware = claimEquals('isAdmin', true);
    const req = createMockRequest({ isAdmin: true });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should call next() when claim equals expected value (null)', () => {
    const middleware = claimEquals('optional', null);
    const req = createMockRequest({ optional: null });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should return 401 when claim does not equal expected value', () => {
    const middleware = claimEquals('role', 'admin');
    const req = createMockRequest({ role: 'user' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.header).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining("error=\"invalid_token\"")
    );
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: "Unexpected 'role' value",
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should use custom error message when provided', () => {
    const middleware = claimEquals('role', 'admin', {
      errorMessage: 'You must be an administrator'
    });
    const req = createMockRequest({ role: 'user' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: 'You must be an administrator',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when claim is missing', () => {
    const middleware = claimEquals('role', 'admin');
    const req = createMockRequest({ name: 'John' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: "Missing 'role' claim",
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when no token is present', () => {
    const middleware = claimEquals('role', 'admin');
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

  it('should throw TypeError when claim is not a string', () => {
    expect(() => claimEquals(123 as any, 'value')).toThrow(TypeError);
    expect(() => claimEquals(123 as any, 'value')).toThrow("'claim' must be a string");
  });

  it('should throw TypeError when expected is not a JSONPrimitive', () => {
    expect(() => claimEquals('role', {} as any)).toThrow(TypeError);
    expect(() => claimEquals('role', {} as any)).toThrow(
      "'value' must be a string, number, boolean or null"
    );
  });

  it('should handle false boolean correctly', () => {
    const middleware = claimEquals('isActive', false);
    const req = createMockRequest({ isActive: false });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should distinguish between false and 0', () => {
    const middleware = claimEquals('value', 0);
    const req = createMockRequest({ value: false });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
