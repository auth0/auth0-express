import { describe, it, expect, vi, type Mock } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  InvalidConfigurationError,
  InvalidDpopProofError,
  InvalidRequestError,
  InvalidSessionError,
  PoppyUnavailableError,
  SessionEndedError,
  VerifyAccessTokenError,
  toHttpErrorResponse,
} from '@auth0/auth0-api-js';
import type { ApiClient, PoppySession } from '@auth0/auth0-api-js';
import { requiresAuth } from './require-auth.js';
import { markPoppyClient } from '../poppy/poppy-clients.js';
import type { RequiresAuthOptions } from '../types.js';

// The fixed texts that reach the app. Written out here, so the spec fails when the source changes them.
const POPPY_OPTION_WITHOUT_POPPY_ROUTER =
  'requiresAuth() was given the poppy option, but createAuth0Api() was not. Set the poppy option of createAuth0Api() to verify Poppy Sessions.';
const POPPY_REQUEST_FAILED = 'The request could not be verified.';

type HeaderValue = string | string[];
type ResponseMethod = 'status' | 'set' | 'header' | 'json' | 'end';
type Next = Mock<(error?: unknown) => void>;

// What the response was asked to do.
interface Recorded {
  statusCode?: number;
  headers: Record<string, HeaderValue>;
  body?: unknown;
  ended: boolean;
}

interface FakeResponse {
  status(code: number): FakeResponse;
  set(field: string | Record<string, HeaderValue>, value?: HeaderValue): FakeResponse;
  header(field: string | Record<string, HeaderValue>, value?: HeaderValue): FakeResponse;
  json(body: unknown): FakeResponse;
  end(): FakeResponse;
}

// A response that records what it is told, and chains like Express's. `failure` makes one method throw when called.
function createRecorder(failure?: { method: ResponseMethod; error: unknown }) {
  const recorded: Recorded = { headers: {}, ended: false };
  const guard = (method: ResponseMethod) => {
    if (failure?.method === method) {
      throw failure.error;
    }
  };
  const recordHeaders = (field: string | Record<string, HeaderValue>, value?: HeaderValue) => {
    if (typeof field === 'string') {
      recorded.headers[field.toLowerCase()] = value as HeaderValue;
      return;
    }
    for (const [name, entry] of Object.entries(field)) {
      recorded.headers[name.toLowerCase()] = entry;
    }
  };

  const res: FakeResponse = {
    status(code) {
      guard('status');
      recorded.statusCode = code;
      return res;
    },
    set(field, value) {
      guard('set');
      recordHeaders(field, value);
      return res;
    },
    header(field, value) {
      guard('header');
      recordHeaders(field, value);
      return res;
    },
    json(body) {
      guard('json');
      recorded.body = body;
      recorded.ended = true;
      return res;
    },
    end() {
      guard('end');
      recorded.ended = true;
      return res;
    },
  };

  return { res: res as unknown as Response, recorded };
}

interface SetupOptions {
  headers?: Record<string, string>;
  // Whether the client is marked as built with the `poppy` option. Default true.
  poppyClient?: boolean;
  failure?: { method: ResponseMethod; error: unknown };
}

function setup({ headers = {}, poppyClient = true, failure }: SetupOptions = {}) {
  const verifyPoppyRequest = vi.fn();
  const verifyAccessToken = vi.fn();
  const client = { verifyPoppyRequest, verifyAccessToken } as unknown as ApiClient;
  if (poppyClient) {
    markPoppyClient(client);
  }

  const req = {
    method: 'POST',
    originalUrl: '/shop/orders?x=1',
    url: '/orders?x=1',
    headers,
    auth0: { client },
  } as unknown as Request;
  const { res, recorded } = createRecorder(failure);
  const next: Next = vi.fn<(error?: unknown) => void>();

  return {
    client,
    req,
    recorded,
    next,
    verifyPoppyRequest,
    verifyAccessToken,
    run: (options?: RequiresAuthOptions) => requiresAuth(options)(req, res, next as NextFunction),
  };
}

const nothingRecorded: Recorded = { headers: {}, ended: false };

const poppy: PoppySession = {
  sessionId: 'sid_123',
  key: 'key_123',
  userId: 'pairwise_user_1',
  agent: { cimdUrl: 'https://agent.example.com/client.json' },
  state: 'signed_out',
  source: 'header',
};
const signedInPoppy: PoppySession = { ...poppy, state: 'signed_in' };

const claims = {
  sub: 'user_123',
  aud: 'https://api.example.com',
  iss: 'https://auth0.local/',
  scope: 'orders:read orders:write',
};

// `req.auth0` still holds only what the router put there, token included: a hidden `token` is not enumerable.
function expectNothingAdded(req: Request, client: ApiClient) {
  expect(req.auth0).toStrictEqual({ client });
  expect(Object.getOwnPropertyNames(req.auth0)).toEqual(['client']);
}

// The answer to a request with no credentials, which a route without the Poppy option gives as well.
function expectBareChallenge(recorded: Recorded) {
  expect(recorded.statusCode).toBe(401);
  expect(recorded.headers).toEqual({ 'www-authenticate': 'Bearer' });
  expect(recorded.body).toBeUndefined();
  expect(recorded.ended).toBe(true);
}

function expectRequestFailed(next: Next, cause: unknown) {
  expect(next).toHaveBeenCalledTimes(1);
  const error = next.mock.calls[0]?.[0] as Error & { status?: number };
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe(POPPY_REQUEST_FAILED);
  expect(error.status).toBe(500);
  expect(error.cause).toBe(cause);
}

// Names what a request got, so that one table can list the outcome of every case.
function outcomeOf(recorded: Recorded, next: Next): string {
  if (next.mock.calls.length > 0) {
    const [call] = next.mock.calls;
    if (next.mock.calls.length === 1 && call?.length === 0) return 'route runs';
    const error = call?.[0] as { message?: string; status?: number } | undefined;
    const nothingSent =
      recorded.statusCode === undefined && !recorded.ended && Object.keys(recorded.headers).length === 0;
    if (
      next.mock.calls.length === 1 &&
      error?.message === POPPY_REQUEST_FAILED &&
      error.status === 500 &&
      nothingSent
    ) {
      return '500 error';
    }
    return 'next() with an argument';
  }
  const challenge = recorded.headers['www-authenticate'];
  if (recorded.statusCode === 401 && challenge === 'Bearer') return 'bare 401';
  if (recorded.statusCode === 401 && Array.isArray(challenge)) return 'sign-in 401';
  if (recorded.statusCode === 403) return '403';
  return `status ${recorded.statusCode}`;
}

describe('requiresAuth on a Poppy router', () => {
  describe('the call to verifyPoppyRequest', () => {
    it('should be made once with the original URL, the request headers and no required Session', async () => {
      const { req, run, verifyPoppyRequest } = setup({ headers: { 'poppy-session': 'a.b.c' } });
      verifyPoppyRequest.mockResolvedValue({});

      await run();

      expect(verifyPoppyRequest).toHaveBeenCalledTimes(1);
      expect(verifyPoppyRequest).toHaveBeenCalledWith({
        method: 'POST',
        url: '/shop/orders?x=1',
        headers: req.headers,
        requireSession: false,
      });
      // The very object, so nothing is dropped or renamed on the way.
      expect(verifyPoppyRequest.mock.calls[0]?.[0].headers).toBe(req.headers);
    });

    it('should ask for a Session when the route sets requireSession', async () => {
      const { run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockResolvedValue({ poppy });

      await run({ poppy: { requireSession: true } });

      expect(verifyPoppyRequest).toHaveBeenCalledTimes(1);
      expect(verifyPoppyRequest).toHaveBeenCalledWith(expect.objectContaining({ requireSession: true }));
    });

    it.each([
      ['no requireSession', {}],
      ['requireSession false', { requireSession: false }],
      ['a requireSession that is truthy but not true', { requireSession: 'yes' as unknown as boolean }],
    ])('should not ask for a Session with %s', async (_label, poppyOptions) => {
      const { run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockResolvedValue({});

      await run({ poppy: poppyOptions });

      expect(verifyPoppyRequest).toHaveBeenCalledWith(expect.objectContaining({ requireSession: false }));
    });

    it.each<[string, (verify: Mock) => void]>([
      ['no credentials', (verify) => verify.mockResolvedValue({})],
      ['a Session', (verify) => verify.mockResolvedValue({ poppy })],
      ['verified claims', (verify) => verify.mockResolvedValue({ claims })],
      ['a Session and claims', (verify) => verify.mockResolvedValue({ poppy: signedInPoppy, claims })],
      ['a Session error', (verify) => verify.mockRejectedValue(new InvalidSessionError('claim_mismatch'))],
      ['an unexpected error', (verify) => verify.mockRejectedValue(new Error('db down'))],
    ])('should never verify the access token itself, with %s', async (_label, outcome) => {
      const { run, verifyPoppyRequest, verifyAccessToken } = setup({ headers: { authorization: 'Bearer tok.en' } });
      outcome(verifyPoppyRequest);

      await run();

      expect(verifyAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('a request with no Session and no access token', () => {
    it.each([
      ['an empty result', {}],
      ['a result with both parts undefined', { poppy: undefined, claims: undefined }],
    ])('should answer 401 with a bare Bearer challenge for %s', async (_label, result) => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockResolvedValue(result);

      await run();

      expectBareChallenge(recorded);
      expect(next).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });

    it('should answer the same on a route with scopes', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockResolvedValue({});

      await run({ scopes: ['orders:read'] });

      expectBareChallenge(recorded);
      expect(next).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });

    it.each<[string, RequiresAuthOptions | undefined]>([
      ['a route with no options', undefined],
      ['a route that requires a Session', { poppy: { requireSession: true } }],
    ])('should answer the same for a truthy result that is not an object, on %s', async (_label, options) => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockResolvedValue('ok');

      await run(options);

      expectBareChallenge(recorded);
      expect(next).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });
  });

  describe('a Session and no access token', () => {
    describe('on a route that sets neither requireSession nor scopes', () => {
      it('should answer 401 with a bare Bearer challenge and not run the route', async () => {
        const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
        verifyPoppyRequest.mockResolvedValue({ poppy });

        await run();

        expectBareChallenge(recorded);
        expect(next).not.toHaveBeenCalled();
        expectNothingAdded(req, client);
      });

      it.each<[string, RequiresAuthOptions]>([
        ['requireSession false', { poppy: { requireSession: false } }],
        ['a requireSession that is truthy but not true', { poppy: { requireSession: 1 as unknown as boolean } }],
        ['an empty list of scopes', { scopes: [] }],
      ])('should answer the same with %s', async (_label, options) => {
        const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
        verifyPoppyRequest.mockResolvedValue({ poppy });

        await run(options);

        expectBareChallenge(recorded);
        expect(next).not.toHaveBeenCalled();
        expectNothingAdded(req, client);
      });
    });

    describe('on a route that sets requireSession and no scopes', () => {
      it('should call next() with no argument and expose only the Session', async () => {
        const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
        verifyPoppyRequest.mockResolvedValue({ poppy });

        await run({ poppy: { requireSession: true } });

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.auth0).toStrictEqual({ client, poppy });
        expect(req.auth0.poppy).toBe(poppy);
        expect(Object.getOwnPropertyDescriptor(req.auth0, 'token')).toBeUndefined();
        expect(recorded).toStrictEqual(nothingRecorded);
      });

      // Scopes that are not empty but name no scope, such as `' '`, are not here: they end in the fixed 500 error (see
      // "a scopes option that is not empty but names no scope").
      it.each<[string, string | string[]]>([
        ['an empty list', []],
        ['an empty string', ''],
      ])('should call next() when the scopes are %s', async (_label, scopes) => {
        const { client, req, next, run, verifyPoppyRequest } = setup();
        verifyPoppyRequest.mockResolvedValue({ poppy });

        await run({ scopes, poppy: { requireSession: true } });

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.auth0).toStrictEqual({ client, poppy });
      });
    });

    describe('on a route with scopes', () => {
      const challenges = [
        'Bearer realm="api", scope="orders:read orders:write"',
        'DPoP scope="orders:read orders:write", algs="ES256"',
      ];

      it.each([
        ['a list', ['orders:read', 'orders:write'], undefined],
        ['a list', ['orders:read', 'orders:write'], { requireSession: true }],
        ['a string with extra spaces', ' orders:read  orders:write ', undefined],
        ['a string with extra spaces', ' orders:read  orders:write ', { requireSession: true }],
      ])(
        'should answer 401 with the sign-in challenges for scopes as %s (requireSession %j)',
        async (_label, scopes, poppyOptions) => {
          const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
          verifyPoppyRequest.mockResolvedValue({ poppy });

          await run({ scopes, poppy: poppyOptions });

          expect(recorded.statusCode).toBe(401);
          expect(recorded.headers).toEqual({ 'www-authenticate': challenges });
          expect(recorded.body).toBeUndefined();
          expect(recorded.ended).toBe(true);
          expect(next).not.toHaveBeenCalled();
          expectNothingAdded(req, client);
        }
      );
    });
  });

  describe('an access token with the scopes the route needs', () => {
    it.each([['Bearer'], ['DPoP'], ['bearer'], ['DPOP']])(
      'should call next() with the claims and a hidden token for a %s credential',
      async (scheme) => {
        const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
          headers: { authorization: `${scheme} tok.en` },
        });
        verifyPoppyRequest.mockResolvedValue({ claims });

        await run();

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.auth0.user).toBe(claims);
        expect(req.auth0.token).toBe('tok.en');
        expect(req.auth0.client).toBe(client);
        // Hidden from anything that enumerates `req.auth0`, and still writable and configurable as before.
        expect(Object.keys(req.auth0)).not.toContain('token');
        expect(Object.getOwnPropertyDescriptor(req.auth0, 'token')).toEqual({
          value: 'tok.en',
          enumerable: false,
          writable: true,
          configurable: true,
        });
        expect(JSON.stringify(req.auth0)).not.toContain('tok.en');
        expect(Object.getOwnPropertyDescriptor(req.auth0, 'poppy')).toBeUndefined();
        expect(recorded).toStrictEqual(nothingRecorded);
      }
    );

    it.each([
      ['no scopes', undefined],
      ['a single scope', 'orders:read'],
      ['every scope, as a list', ['orders:read', 'orders:write']],
      ['every scope, as one string', 'orders:read orders:write'],
      ['every scope, as a string with extra spaces', '  orders:write   orders:read '],
      ['an empty list', []],
    ])('should call next() with %s required', async (_label, scopes) => {
      const { req, next, run, verifyPoppyRequest } = setup({ headers: { authorization: 'Bearer tok.en' } });
      verifyPoppyRequest.mockResolvedValue({ claims });

      await run({ scopes });

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(req.auth0.user).toBe(claims);
    });

    it('should accept an empty claims object, which is still a verified claims object', async () => {
      const { req, next, run, verifyPoppyRequest } = setup({ headers: { authorization: 'Bearer tok.en' } });
      const emptyClaims = {};
      verifyPoppyRequest.mockResolvedValue({ claims: emptyClaims });

      await run();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(req.auth0.user).toBe(emptyClaims);
    });

    it('should accept a scope claim that is already an array', async () => {
      const { req, next, run, verifyPoppyRequest } = setup({ headers: { authorization: 'Bearer tok.en' } });
      const arrayClaims = { ...claims, scope: ['orders:read'] };
      verifyPoppyRequest.mockResolvedValue({ claims: arrayClaims });

      await run({ scopes: 'orders:read' });

      expect(next).toHaveBeenCalledWith();
      expect(req.auth0.user).toBe(arrayClaims);
    });

    it('should also expose the Session when the request has one', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
        headers: { authorization: 'DPoP tok.en' },
      });
      verifyPoppyRequest.mockResolvedValue({ poppy: signedInPoppy, claims });

      await run({ scopes: 'orders:read' });

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(req.auth0.user).toBe(claims);
      expect(req.auth0.poppy).toBe(signedInPoppy);
      expect(req.auth0.token).toBe('tok.en');
      expect(req.auth0.client).toBe(client);
      expect(Object.keys(req.auth0).sort()).toEqual(['client', 'poppy', 'user']);
      expect(Object.getOwnPropertyDescriptor(req.auth0, 'token')).toEqual({
        value: 'tok.en',
        enumerable: false,
        writable: true,
        configurable: true,
      });
      expect(recorded).toStrictEqual(nothingRecorded);
    });
  });

  describe('an access token without a scope the route needs', () => {
    const insufficientScope = (scope: string) =>
      `Bearer error="insufficient_scope", error_description="Insufficient scopes", scope="${scope}"`;

    it.each([
      ['claims alone', { claims: { sub: 'user_123', scope: 'orders:read' } }],
      ['claims and a Session', { poppy: signedInPoppy, claims: { sub: 'user_123', scope: 'orders:read' } }],
    ])('should answer 403 insufficient_scope for %s', async (_label, result) => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
        headers: { authorization: 'Bearer tok.en' },
      });
      verifyPoppyRequest.mockResolvedValue(result);

      await run({ scopes: 'orders:write' });

      expect(recorded.statusCode).toBe(403);
      expect(recorded.headers).toEqual({ 'www-authenticate': insufficientScope('orders:write') });
      expect(recorded.body).toEqual({ error: 'insufficient_scope', error_description: 'Insufficient scopes' });
      expect(recorded.ended).toBe(true);
      expect(next).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });

    it('should name every scope the route needs, as the list of a string split on spaces', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
        headers: { authorization: 'Bearer tok.en' },
      });
      verifyPoppyRequest.mockResolvedValue({ claims: { sub: 'user_123', scope: 'orders:read' } });

      await run({ scopes: ' orders:read  orders:write ' });

      expect(recorded.statusCode).toBe(403);
      expect(recorded.headers).toEqual({ 'www-authenticate': insufficientScope('orders:read orders:write') });
      expect(next).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });

    it('should answer 403 when the claims carry no scope at all', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
        headers: { authorization: 'Bearer tok.en' },
      });
      verifyPoppyRequest.mockResolvedValue({ claims: { sub: 'user_123' } });

      await run({ scopes: ['orders:read'] });

      expect(recorded.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });
  });

  // `''` and `[]` say that the route needs no scope. A scopes option that is not empty but splits into no scope (a list
  // built from a setting that came out empty, say) says nothing, which can only be a mistake. A router without `poppy`
  // refuses every request to such a route, so the Poppy router must not open it. It ends in the fixed 500 error, as a
  // scope with a double quote does, before anything is verified.
  describe('a scopes option that is not empty but names no scope', () => {
    const blankScopes =
      'The scopes option of requiresAuth() is not empty, but it names no scope. Leave it out for a route that needs no scope.';

    const blank: [string, string | string[]][] = [
      ['a string of one space', ' '],
      ['a string of several spaces', '   '],
      ['a list of one empty string', ['']],
      ['a list of one string of spaces', [' ']],
      ['a list of empty strings and spaces', ['', ' ', '  ']],
    ];

    // The requests that a route with such scopes used to answer 401, or to let through.
    const requests: [string, Record<string, unknown>, Record<string, string>, RequiresAuthOptions['poppy']][] = [
      ['no credentials', {}, {}, undefined],
      ['a Session alone on a route that sets requireSession', { poppy }, {}, { requireSession: true }],
      ['an access token', { claims }, { authorization: 'Bearer tok.en' }, undefined],
      [
        'a Session and an access token',
        { poppy: signedInPoppy, claims },
        { authorization: 'Bearer tok.en' },
        undefined,
      ],
    ];

    const cases = blank.flatMap(([what, scopes]) =>
      requests.map(([request, result, headers, poppyOptions]) => ({
        what,
        scopes,
        request,
        result,
        headers,
        poppyOptions,
      }))
    );

    it.each(cases)(
      'should pass the fixed 500 error to next() and verify nothing for $what, with $request',
      async ({ scopes, result, headers, poppyOptions }) => {
        const { client, req, recorded, next, run, verifyPoppyRequest, verifyAccessToken } = setup({ headers });
        verifyPoppyRequest.mockResolvedValue(result);

        await expect(run({ scopes, poppy: poppyOptions })).resolves.toBeUndefined();

        expect(next).toHaveBeenCalledTimes(1);
        const error = next.mock.calls[0]?.[0] as Error & { status?: number };
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe(POPPY_REQUEST_FAILED);
        expect(error.status).toBe(500);
        expect((error.cause as Error).message).toBe(blankScopes);
        expect(verifyPoppyRequest).not.toHaveBeenCalled();
        expect(verifyAccessToken).not.toHaveBeenCalled();
        expect(recorded).toStrictEqual(nothingRecorded);
        expectNothingAdded(req, client);
      }
    );

    it.each([
      ['an empty string', ''],
      ['an empty list', []],
      ['no scopes', undefined],
    ])('should still run the route for an access token when the scopes are %s', async (_label, scopes) => {
      const { req, next, run, verifyPoppyRequest } = setup({ headers: { authorization: 'Bearer tok.en' } });
      verifyPoppyRequest.mockResolvedValue({ claims: { sub: 'user_123' } });

      await run({ scopes });

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(req.auth0.user).toEqual({ sub: 'user_123' });
    });

    it.each([
      ['an empty entry before a scope', ['', 'orders:read']],
      ['spaces around a scope', ' orders:read '],
    ])('should ignore the blank part of the scopes while a scope is left, for %s', async (_label, scopes) => {
      const allowed = setup({ headers: { authorization: 'Bearer tok.en' } });
      allowed.verifyPoppyRequest.mockResolvedValue({ claims });
      const refused = setup({ headers: { authorization: 'Bearer tok.en' } });
      refused.verifyPoppyRequest.mockResolvedValue({ claims: { sub: 'user_123', scope: 'orders:write' } });

      await allowed.run({ scopes });
      await refused.run({ scopes });

      expect(allowed.next).toHaveBeenCalledWith();
      expect(refused.next).not.toHaveBeenCalled();
      expect(refused.recorded.statusCode).toBe(403);
      expect(refused.recorded.headers['www-authenticate']).toContain('scope="orders:read"');
    });

    it.each([[' '], [['']], [[' ']]])(
      'should leave a router without poppy as it was, a request refused with 403, for the scopes %j',
      async (scopes) => {
        const { recorded, next, run, verifyAccessToken } = setup({
          poppyClient: false,
          headers: { authorization: 'Bearer tok.en' },
        });
        verifyAccessToken.mockResolvedValue({ sub: 'user_123', scope: 'orders:read' });

        await run({ scopes });

        expect(recorded.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
      }
    );
  });

  describe('which requests reach the route', () => {
    const read = { sub: 'user_123', scope: 'orders:read' };
    const session = { poppy };
    const token = { claims: read };
    const both = { poppy: signedInPoppy, claims: read };

    // A request reaches the route only when it has verified claims that cover the scopes, or a verified Session on a
    // route that sets requireSession and has no scopes. Everything else is refused here. The real verifyPoppyRequest
    // never returns claims without a Session for a route that sets requireSession, nor a null part, so those results
    // are not to be trusted: they end in the fixed 500 error, before the scopes are looked at.
    const row = (
      request: string,
      result: Record<string, unknown>,
      requireSession: boolean,
      scopes: string | undefined,
      outcome: string
    ) => ({ request, result, requireSession, scopes, outcome });

    it.each([
      row('no Session and no token', {}, false, undefined, 'bare 401'),
      row('no Session and no token', {}, true, undefined, 'bare 401'),
      row('no Session and no token', {}, false, 'orders:read', 'bare 401'),
      row('no Session and no token', {}, true, 'orders:read', 'bare 401'),
      row('a Session and no token', session, false, undefined, 'bare 401'),
      row('a Session and no token', session, true, undefined, 'route runs'),
      row('a Session and no token', session, false, 'orders:read', 'sign-in 401'),
      row('a Session and no token', session, true, 'orders:read', 'sign-in 401'),
      row('a token and no Session', token, false, undefined, 'route runs'),
      row('a token and no Session', token, false, 'orders:read', 'route runs'),
      row('a token and no Session', token, false, 'orders:write', '403'),
      row('a Session and a token', both, false, undefined, 'route runs'),
      row('a Session and a token', both, true, undefined, 'route runs'),
      row('a Session and a token', both, false, 'orders:read', 'route runs'),
      row('a Session and a token', both, true, 'orders:read', 'route runs'),
      row('a Session and a token', both, false, 'orders:write', '403'),
      row('a Session and a token', both, true, 'orders:write', '403'),
      row('an empty claims object', { claims: {} }, false, undefined, 'route runs'),
      row('a token and no Session', token, true, undefined, '500 error'),
      row('a token and no Session', token, true, 'orders:read', '500 error'),
      row('a token and no Session', token, true, 'orders:write', '500 error'),
      row('null claims', { claims: null }, false, undefined, '500 error'),
      row('null claims', { claims: null }, true, undefined, '500 error'),
      row('null claims', { claims: null }, false, 'orders:read', '500 error'),
      row('a null Session', { poppy: null }, false, undefined, '500 error'),
      row('a null Session', { poppy: null }, true, undefined, '500 error'),
      row('a null Session', { poppy: null }, false, 'orders:read', '500 error'),
      row('null claims and a null Session', { claims: null, poppy: null }, false, undefined, '500 error'),
      row('claims and a null Session', { claims: read, poppy: null }, false, undefined, '500 error'),
      row('null claims and a Session', { claims: null, poppy: signedInPoppy }, true, undefined, '500 error'),
    ])(
      'with $request (requireSession $requireSession, scopes $scopes) the outcome is $outcome',
      async ({ result, requireSession, scopes, outcome }) => {
        const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
          headers: result.claims === undefined ? {} : { authorization: 'Bearer tok.en' },
        });
        verifyPoppyRequest.mockResolvedValue(result);

        await run({ scopes, poppy: { requireSession } });

        expect(outcomeOf(recorded, next)).toBe(outcome);
        // Whatever stops a request leaves `req.auth0` as the router put it.
        if (outcome !== 'route runs') {
          expectNothingAdded(req, client);
        }
      }
    );
  });

  describe('a result that verifyPoppyRequest does not return', () => {
    const read = { sub: 'user_123', scope: 'orders:read' };
    const withoutSession = 'verifyPoppyRequest returned claims without the Session that the route requires.';
    const nullPart = 'verifyPoppyRequest returned null for the claims or for the Session.';
    const requireSession = { poppy: { requireSession: true } };

    // Each ends in the fixed 500 error, with the reason in `cause`. None writes a response, none sets anything on
    // `req.auth0`, and none calls next() without an error, whatever the scopes of the route say.
    it.each([
      {
        what: 'claims without the Session that the route requires',
        result: { claims: read },
        options: requireSession,
        cause: withoutSession,
      },
      {
        what: 'claims without the Session, on a route whose scopes they lack',
        result: { claims: read },
        options: { scopes: 'orders:write', ...requireSession },
        cause: withoutSession,
      },
      { what: 'null claims', result: { claims: null }, options: undefined, cause: nullPart },
      {
        what: 'null claims on a route that requires a Session',
        result: { claims: null },
        options: requireSession,
        cause: nullPart,
      },
      { what: 'a null Session', result: { poppy: null }, options: undefined, cause: nullPart },
      {
        what: 'a null Session on a route that requires one',
        result: { poppy: null },
        options: requireSession,
        cause: nullPart,
      },
      {
        what: 'a null Session on a route with scopes',
        result: { poppy: null },
        options: { scopes: 'orders:read' },
        cause: nullPart,
      },
      { what: 'claims and a null Session', result: { claims: read, poppy: null }, options: undefined, cause: nullPart },
      {
        what: 'null claims and a Session',
        result: { claims: null, poppy: signedInPoppy },
        options: undefined,
        cause: nullPart,
      },
    ])('should pass the fixed 500 error to next() for $what', async ({ result, options, cause }) => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
        headers: { authorization: 'Bearer tok.en' },
      });
      verifyPoppyRequest.mockResolvedValue(result);

      await expect(run(options)).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0]?.[0] as Error & { status?: number };
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(POPPY_REQUEST_FAILED);
      expect(error.status).toBe(500);
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe(cause);
      expect(recorded).toStrictEqual(nothingRecorded);
      expectNothingAdded(req, client);
    });

    it('should still answer an empty result with the bare challenge on a route that requires a Session', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockResolvedValue({});

      await run(requireSession);

      expectBareChallenge(recorded);
      expect(next).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });
  });

  describe('when verifyPoppyRequest rejects with an error that has an HTTP response', () => {
    const challenge = (value: string) => ({ 'www-authenticate': value });

    it.each([
      ['an InvalidSessionError', new InvalidSessionError('claim_mismatch'), 400],
      ['a SessionEndedError', new SessionEndedError(), 400],
      ['a PoppyUnavailableError', new PoppyUnavailableError(), 503],
      [
        'a VerifyAccessTokenError',
        new VerifyAccessTokenError('The token has expired', challenge('Bearer error="invalid_token"')),
        401,
      ],
      [
        'an InvalidRequestError',
        new InvalidRequestError('The Authorization header is malformed', challenge('Bearer error="invalid_request"')),
        400,
      ],
      [
        'an InvalidDpopProofError',
        new InvalidDpopProofError('The DPoP proof is invalid', challenge('DPoP error="invalid_dpop_proof"')),
        400,
      ],
    ])('should send what toHttpErrorResponse gives for %s', async (_label, error, status) => {
      const expected = toHttpErrorResponse(error)!;
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockRejectedValue(error);

      await run();

      expect(recorded.statusCode).toBe(status);
      expect(recorded.statusCode).toBe(expected.status);
      expect(recorded.headers).toEqual(expected.headers);
      expect(recorded.body).toEqual(expected.body);
      expect(recorded.ended).toBe(true);
      expect(next).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });

    it('should send a Session error as 400 with its JSON body and no challenge', async () => {
      const { recorded, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockRejectedValue(new InvalidSessionError('claim_mismatch'));

      await run();

      expect(recorded.statusCode).toBe(400);
      expect(recorded.headers).toEqual({});
      expect(recorded.headers['www-authenticate']).toBeUndefined();
      expect(recorded.body).toEqual({
        error: 'invalid_session',
        error_description: "A Session JWT claim (aud, htm or htu) doesn't match the request.",
      });
    });

    it('should send a temporarily unavailable error as 503 with a retry-after of 30 seconds', async () => {
      const { recorded, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockRejectedValue(new PoppyUnavailableError());

      await run();

      expect(recorded.statusCode).toBe(503);
      expect(recorded.headers['retry-after']).toBe('30');
      expect(recorded.body).toEqual(expect.objectContaining({ error: 'temporarily_unavailable' }));
    });

    it('should send the token errors with their challenges and no body', async () => {
      const { recorded, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockRejectedValue(
        new VerifyAccessTokenError('The token has expired', challenge('Bearer error="invalid_token"'))
      );

      await run();

      expect(recorded.statusCode).toBe(401);
      expect(recorded.headers).toEqual({ 'www-authenticate': 'Bearer error="invalid_token"' });
      expect(recorded.body).toBeUndefined();
      expect(recorded.ended).toBe(true);
    });

    it('should answer the same on a route with scopes and requireSession', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockRejectedValue(new SessionEndedError());

      await run({ scopes: 'orders:read', poppy: { requireSession: true } });

      expect(recorded.statusCode).toBe(400);
      expect(recorded.body).toEqual(expect.objectContaining({ error: 'session_ended' }));
      expect(next).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });
  });

  describe('when something unexpected goes wrong', () => {
    it.each([
      ['an Error', new Error('db down: secret')],
      ['an InvalidConfigurationError', new InvalidConfigurationError('x')],
      ['a string', 'boom'],
    ])('should pass the fixed 500 error to next() when verification rejects with %s', async (_label, rejection) => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockRejectedValue(rejection);

      await expect(run()).resolves.toBeUndefined();

      expectRequestFailed(next, rejection);
      expect(recorded).toStrictEqual(nothingRecorded);
      expectNothingAdded(req, client);
    });

    it('should pass the fixed 500 error to next() when verifyPoppyRequest throws at once', async () => {
      const boom = new Error('thrown at once');
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockImplementation(() => {
        throw boom;
      });

      await expect(run()).resolves.toBeUndefined();

      expectRequestFailed(next, boom);
      expect(recorded).toStrictEqual(nothingRecorded);
      expectNothingAdded(req, client);
    });

    it('should pass the fixed 500 error to next() when the result is not an object', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockResolvedValue(undefined);

      await expect(run()).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: POPPY_REQUEST_FAILED, status: 500 }));
      expect(recorded).toStrictEqual(nothingRecorded);
      expectNothingAdded(req, client);
    });

    it('should pass the fixed 500 error to next() when the sign-in challenge cannot be built', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockResolvedValue({ poppy });

      await expect(run({ scopes: 'orders"write' })).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0]?.[0] as Error & { status?: number };
      expect(error.message).toBe(POPPY_REQUEST_FAILED);
      expect(error.status).toBe(500);
      expect(error.cause).toBeInstanceOf(InvalidConfigurationError);
      expect(recorded).toStrictEqual(nothingRecorded);
      expectNothingAdded(req, client);
    });

    it('should pass the fixed 500 error to next() when the claims came with no credential to read', async () => {
      // No `Authorization` header, so there is no token to hand on, whatever the result says.
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();
      verifyPoppyRequest.mockResolvedValue({ claims });

      await expect(run()).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0]?.[0] as Error & { status?: number };
      expect(error.message).toBe(POPPY_REQUEST_FAILED);
      expect(error.status).toBe(500);
      expect(error.cause).toBeInstanceOf(Error);
      expect(recorded).toStrictEqual(nothingRecorded);
      // The claims are not exposed either, since the request does not go on.
      expectNothingAdded(req, client);
    });

    it('should pass the fixed 500 error to next() when the scope claim is not a list or a string', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
        headers: { authorization: 'Bearer tok.en' },
      });
      verifyPoppyRequest.mockResolvedValue({ claims: { sub: 'user_123', scope: 42 } });

      await expect(run({ scopes: 'orders:read' })).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: POPPY_REQUEST_FAILED, status: 500 }));
      expect(recorded).toStrictEqual(nothingRecorded);
      expectNothingAdded(req, client);
    });

    it('should pass the fixed 500 error to next() when plain JavaScript passes null as the options', async () => {
      // A router without `poppy` still answers such a route (see below). A Poppy router reads the options first, so
      // this ends in the fixed error: closed and loud, and nothing is verified.
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup();

      await expect(run(null as unknown as RequiresAuthOptions)).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0]?.[0] as Error & { status?: number };
      expect(error.message).toBe(POPPY_REQUEST_FAILED);
      expect(error.status).toBe(500);
      expect(error.cause).toBeInstanceOf(TypeError);
      expect(verifyPoppyRequest).not.toHaveBeenCalled();
      expect(recorded).toStrictEqual(nothingRecorded);
      expectNothingAdded(req, client);
    });

    it('should pass the fixed 500 error to next() when setting req.auth0 throws, and not go on', async () => {
      const { client, req, next, run, verifyPoppyRequest } = setup({ headers: { authorization: 'Bearer tok.en' } });
      verifyPoppyRequest.mockResolvedValue({ claims });
      Object.freeze(req.auth0);

      await expect(run()).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: POPPY_REQUEST_FAILED, status: 500 }));
      expect(req.auth0).toStrictEqual({ client });
    });

    it('should pass the fixed 500 error to next() when set throws while answering a Session error', async () => {
      const boom = new Error('headers already sent');
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
        failure: { method: 'set', error: boom },
      });
      verifyPoppyRequest.mockRejectedValue(new InvalidSessionError('claim_mismatch'));

      await expect(run()).resolves.toBeUndefined();

      expectRequestFailed(next, boom);
      // The status may be recorded already, but nothing was sent.
      expect(recorded.ended).toBe(false);
      expect(recorded.body).toBeUndefined();
      expectNothingAdded(req, client);
    });

    it.each([
      {
        answer: 'the bare challenge for no credentials',
        method: 'end' as const,
        mock: (verify: Mock) => verify.mockResolvedValue({}),
        options: undefined,
      },
      {
        answer: 'the bare challenge for a Session with no token',
        method: 'header' as const,
        mock: (verify: Mock) => verify.mockResolvedValue({ poppy }),
        options: undefined,
      },
      {
        answer: 'the sign-in challenge',
        method: 'set' as const,
        mock: (verify: Mock) => verify.mockResolvedValue({ poppy }),
        options: { scopes: 'orders:read' },
      },
      {
        answer: 'the insufficient scope answer',
        method: 'json' as const,
        mock: (verify: Mock) => verify.mockResolvedValue({ claims: { sub: 'user_123', scope: 'orders:read' } }),
        options: { scopes: 'orders:write' },
      },
      {
        answer: 'the JSON body of a Session error',
        method: 'json' as const,
        mock: (verify: Mock) => verify.mockRejectedValue(new SessionEndedError()),
        options: undefined,
      },
      {
        answer: 'the status of a token error',
        method: 'status' as const,
        mock: (verify: Mock) =>
          verify.mockRejectedValue(new VerifyAccessTokenError('expired', { 'www-authenticate': 'Bearer' })),
        options: undefined,
      },
    ])('should pass the fixed 500 error to next() when writing $answer throws', async ({ method, mock, options }) => {
      const boom = new Error(`res.${method} failed`);
      const { client, req, recorded, next, run, verifyPoppyRequest } = setup({
        headers: { authorization: 'Bearer tok.en' },
        failure: { method, error: boom },
      });
      mock(verifyPoppyRequest);

      await expect(run(options)).resolves.toBeUndefined();

      expectRequestFailed(next, boom);
      expect(recorded.ended).toBe(false);
      expectNothingAdded(req, client);
    });
  });

  describe('on a router created without the poppy option', () => {
    it.each([
      ['requireSession true', { requireSession: true }],
      ['an empty object', {}],
    ])('should pass an error to next() for a route with the poppy option as %s', async (_label, poppyOptions) => {
      const { client, req, recorded, next, run, verifyPoppyRequest, verifyAccessToken } = setup({
        poppyClient: false,
        headers: { authorization: 'Bearer tok.en' },
      });

      await run({ poppy: poppyOptions });

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0]?.[0] as Error;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(POPPY_OPTION_WITHOUT_POPPY_ROUTER);
      expect(verifyPoppyRequest).not.toHaveBeenCalled();
      expect(verifyAccessToken).not.toHaveBeenCalled();
      expect(recorded).toStrictEqual(nothingRecorded);
      expectNothingAdded(req, client);
    });

    it('should keep the existing behaviour for a route with no poppy option', async () => {
      const { req, next, run, verifyPoppyRequest, verifyAccessToken } = setup({
        poppyClient: false,
        headers: { authorization: 'Bearer x' },
      });
      verifyAccessToken.mockResolvedValue({ sub: 'user_123' });

      await run();

      expect(verifyAccessToken).toHaveBeenCalledTimes(1);
      expect(verifyAccessToken).toHaveBeenCalledWith({ accessToken: 'x' });
      expect(verifyPoppyRequest).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(req.auth0.user).toEqual({ sub: 'user_123' });
      expect(req.auth0.token).toBe('x');
    });

    it('should still answer a request without credentials when plain JavaScript passes null options', async () => {
      const { client, req, recorded, next, run, verifyPoppyRequest, verifyAccessToken } = setup({
        poppyClient: false,
      });

      await run(null as unknown as RequiresAuthOptions);

      expectBareChallenge(recorded);
      expect(next).not.toHaveBeenCalled();
      expect(verifyPoppyRequest).not.toHaveBeenCalled();
      expect(verifyAccessToken).not.toHaveBeenCalled();
      expectNothingAdded(req, client);
    });

    it('should treat a poppy option that is undefined as not set', async () => {
      const { next, run, verifyPoppyRequest, verifyAccessToken } = setup({
        poppyClient: false,
        headers: { authorization: 'Bearer x' },
      });
      verifyAccessToken.mockResolvedValue({ sub: 'user_123' });

      await run({ poppy: undefined });

      expect(verifyAccessToken).toHaveBeenCalledWith({ accessToken: 'x' });
      expect(verifyPoppyRequest).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });
  });
});
