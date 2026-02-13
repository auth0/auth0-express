/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextFunction, Request, Response } from 'express';
import { claimIncludes } from './claim-includes.js';

describe('claimIncludes', () => {
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

  it('should call next() when all values are included in array claim', () => {
    const middleware = claimIncludes('roles', ['admin', 'editor']);
    const req = createMockRequest({ roles: ['admin', 'editor', 'viewer'] });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should call next() when all values are included in space-separated string claim', () => {
    const middleware = claimIncludes('scope', ['read:msg', 'write:msg']);
    const req = createMockRequest({ scope: 'read:msg write:msg delete:msg' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should call next() with single expected value', () => {
    const middleware = claimIncludes('roles', ['admin']);
    const req = createMockRequest({ roles: ['admin', 'user'] });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should return 401 when not all values are included', () => {
    const middleware = claimIncludes('roles', ['admin', 'superadmin']);
    const req = createMockRequest({ roles: ['admin', 'user'] });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: "Unexpected 'roles' value",
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should use custom error message when provided', () => {
    const middleware = claimIncludes('roles', ['admin', 'editor'], {
      errorMessage: 'You must have both admin and editor roles'
    });
    const req = createMockRequest({ roles: ['admin', 'viewer'] });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: 'You must have both admin and editor roles',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when claim is missing', () => {
    const middleware = claimIncludes('roles', ['admin']);
    const req = createMockRequest({ name: 'John' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: "Missing 'roles' claim",
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when claim is not an array or string', () => {
    const middleware = claimIncludes('roles', ['admin']);
    const req = createMockRequest({ roles: 123 });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: "Unexpected 'roles' value",
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when no token is present', () => {
    const middleware = claimIncludes('roles', ['admin']);
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
    expect(() => claimIncludes(123 as any, ['value'])).toThrow(TypeError);
    expect(() => claimIncludes(123 as any, ['value'])).toThrow("'claim' must be a string");
  });

  it('should throw TypeError when expected values are not JSONPrimitives', () => {
    expect(() => claimIncludes('roles', ['admin', {} as any])).toThrow(TypeError);
    expect(() => claimIncludes('roles', ['admin', {} as any])).toThrow(
      "'expected' values must be strings, numbers, booleans or null"
    );
  });

  it('should handle numeric values in array', () => {
    const middleware = claimIncludes('levels', [1, 2]);
    const req = createMockRequest({ levels: [1, 2, 3] });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle boolean values in array', () => {
    const middleware = claimIncludes('flags', [true, false]);
    const req = createMockRequest({ flags: [true, false] });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle empty array claim', () => {
    const middleware = claimIncludes('roles', ['admin']);
    const req = createMockRequest({ roles: [] });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should handle empty string claim', () => {
    const middleware = claimIncludes('scope', ['read:msg']);
    const req = createMockRequest({ scope: '' });
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
