import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateHeaderValue } from 'node:http';
import { NextFunction, Request, Response } from 'express';
import { VerifyAccessTokenError, type ApiClient } from '@auth0/auth0-api-js';
import { requiresAuth } from './require-auth.js';
import { parseChallenge } from '../test-utils/www-authenticate.js';

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

  it('should forward an error to next() and write no response when the Auth0 router is not registered', async () => {
    const req = { headers: {}, auth0: {} as Request['auth0'] } as Partial<Request>;
    const res = createMockResponse();

    await requiresAuth()(req as Request, res as Response, mockNext as NextFunction);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect((mockNext.mock.calls[0][0] as Error).message).toContain('Auth0 ApiClient not found on request');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should forward the error to next(), and not reject, when the 401 cannot be written', async () => {
    // On Express 4 a rejected promise of a handler ends the process. `res.header` can throw, and the promise must not
    // reject whatever happens.
    const failure = new Error('res.header failed');
    verifyAccessToken.mockRejectedValue(Object.assign(new Error('bad token'), { code: 'verify_access_token_error' }));
    const req = createMockRequest('Bearer a.b.c');
    const res = createMockResponse();
    (res.header as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw failure;
    });

    await expect(requiresAuth()(req as Request, res as Response, mockNext as NextFunction)).resolves.toBeUndefined();

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockNext).toHaveBeenCalledWith(failure);
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

    const printableAscii = String.fromCharCode(...Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i));

    // The message can carry text from the request, such as a `crit` name from
    // the token's header.
    it.each([
      ['every printable ASCII character', printableAscii, printableAscii],
      ['a carriage return', 'bad\rtoken', 'bad?token'],
      ['a line feed', 'bad\ntoken', 'bad?token'],
      ['a CRLF and a header line', 'bad\r\nSet-Cookie: a=b', 'bad??Set-Cookie: a=b'],
      ['other control characters', 'a\0b\tc\x1bd\x1fe\x7ff\x85g', 'a?b?c?d?e?f?g'],
      ['a non-ASCII character', 'caf\u00e9', 'caf?'],
      ['a character above U+00FF', 'costs \u20ac5', 'costs ?5'],
      ['a character outside the BMP', 'smile \u{1F600}', 'smile ?'],
      ['a lone surrogate', 'half \ud800', 'half ?'],
      ['a double quote', 'say "hi"', 'say "hi"'],
      ['a backslash', 'C:\\keys\\jwks', 'C:\\keys\\jwks'],
      ['a trailing backslash', 'ends with \\', 'ends with \\'],
      ['a backslash before a double quote', 'a\\"b', 'a\\"b'],
      ['more than 256 characters', 'a'.repeat(300), 'a'.repeat(256)],
      ['a backslash as the 256th character', `${'a'.repeat(255)}\\${'b'.repeat(40)}`, `${'a'.repeat(255)}\\`],
      ['a double quote as the 256th character', `${'a'.repeat(255)}"${'b'.repeat(40)}`, `${'a'.repeat(255)}"`],
      ['256 characters of non-ASCII text', '\u20ac'.repeat(300), '?'.repeat(256)],
    ])('should write a header that parses for a message with %s', async (_label, message, decoded) => {
      verifyAccessToken.mockRejectedValue(new VerifyAccessTokenError(message));
      const req = createMockRequest('Bearer <token>');
      const res = createMockResponse();

      await requiresAuth()(req as Request, res as Response, mockNext as NextFunction);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.header).toHaveBeenCalledTimes(1);
      const [name, value] = vi.mocked(res.header!).mock.calls[0] as [string, string];
      expect(name).toBe('WWW-Authenticate');
      expect(() => validateHeaderValue(name, value)).not.toThrow();
      expect(value).toMatch(/^[\x20-\x7e]+$/);
      expect(parseChallenge(value)).toEqual({
        scheme: 'Bearer',
        params: [
          ['error', 'invalid_token'],
          ['error_description', decoded],
        ],
      });
      // JSON can carry any text, so the body keeps the message as it was.
      expect(res.json).toHaveBeenCalledWith({ error: 'invalid_token', error_description: message });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('when next() throws on a verified request', () => {
    // Express's own `next()` never throws, so this is for a middleware that is called by hand.
    it('should pass the error to next() and not answer it as a failed token', async () => {
      const failure = new Error('<a middleware further down failed>');
      verifyAccessToken.mockResolvedValue({ sub: 'user_123' });
      mockNext.mockImplementationOnce(() => {
        throw failure;
      });
      const req = createMockRequest('Bearer <token>');
      const res = createMockResponse();

      await expect(
        requiresAuth()(req as Request, res as Response, mockNext as NextFunction)
      ).resolves.toBeUndefined();

      expect(res.status).not.toHaveBeenCalled();
      expect(res.header).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(2);
      expect(mockNext).toHaveBeenNthCalledWith(1);
      expect(mockNext).toHaveBeenNthCalledWith(2, failure);
    });
  });

  // Express 4 ignores the promise a middleware returns, so a rejection is
  // unhandled, and that ends the process under Node's default settings.
  describe('when writing the response throws', () => {
    const failure = new Error('<cannot write the response>');

    it.each([
      ['no token is present', 'header', undefined],
      ['verification fails', 'header', 'verification'],
      ['verification fails', 'json', 'verification'],
      ['a required scope is missing', 'header', 'scope'],
      ['a required scope is missing', 'json', 'scope'],
    ] as const)('should pass the error to next() when %s and res.%s() throws', async (_label, method, outcome) => {
      if (outcome === 'verification') {
        verifyAccessToken.mockRejectedValue(new VerifyAccessTokenError('"exp" claim timestamp check failed'));
      } else if (outcome === 'scope') {
        verifyAccessToken.mockResolvedValue({ sub: 'user_123', scope: 'read:messages' });
      }
      const middleware = requiresAuth(outcome === 'scope' ? { scopes: 'write:messages' } : {});
      const req = createMockRequest(outcome ? 'Bearer <token>' : undefined);
      const res = createMockResponse();
      vi.mocked(res[method]!).mockImplementation(() => {
        throw failure;
      });

      await expect(middleware(req as Request, res as Response, mockNext as NextFunction)).resolves.toBeUndefined();

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(failure);
    });
  });
});
