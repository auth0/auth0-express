import { Request, Response, NextFunction } from 'express';
import type { RequiresAuthOptions, Token } from '../types.js';
import { sendBearerError } from './claim-auth.js';
import { SignInRequiredError, toHttpErrorResponse } from '@auth0/auth0-api-js';
import type { ApiClient, VerifiedPoppyRequest } from '@auth0/auth0-api-js';
import { isPoppyClient } from '../poppy/poppy-clients.js';

function validateScopes(token: Token, requiredScopes: string | string[]): boolean {
  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

  // Extract token scopes (handling different formats)
  let tokenScopes: string[] = [];

  if (token.scope) {
    tokenScopes = typeof token.scope === 'string' ? token.scope.split(' ') : token.scope;
  }

  // All required scopes must be present
  return scopes.every((required) => tokenScopes.includes(required));
}

function getToken(req: Request): string | undefined {
  const parts = req.headers.authorization?.split(' ');
  return parts?.length === 2 && parts[0]?.toLowerCase() === 'bearer' ? parts[1] : undefined;
}

/**
 * Middleware factory to require authentication on a route
 *
 * On a router created with the `poppy` option of `createAuth0Api()`, it also verifies the `Poppy-Session` header of a
 * Personal Agent (beta) when `verifySession` is on, and on every route that sets `requireSession`. See the `poppy`
 * option of {@link RequiresAuthOptions} for what a route can ask of the Session.
 *
 * @param options RequiresAuthOptions
 * @returns Express middleware function
 */
export function requiresAuth(options: RequiresAuthOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const apiClient = req.auth0?.client;

    if (!apiClient) {
      return next(
        new Error('Auth0 ApiClient not found on request. Make sure the Auth0 Express API router is registered.')
      );
    }

    if (isPoppyClient(apiClient)) return requiresPoppyAuth(req, res, next, apiClient, options);
    if (options?.poppy !== undefined) return next(new Error(POPPY_OPTION_WITHOUT_POPPY_ROUTER));

    const accessToken = getToken(req);

    if (!accessToken) {
      return res.status(401).header('WWW-Authenticate', 'Bearer').end();
    }

    try {
      const token = (await apiClient.verifyAccessToken({ accessToken })) as Token;

      if (options.scopes && !validateScopes(token, options.scopes)) {
        return sendBearerError(res, 403, 'insufficient_scope', 'Insufficient scopes');
      }

      req.auth0.user = token;
      // Non-enumerable, so logging or serialising `req.auth0` cannot leak it.
      Object.defineProperty(req.auth0, 'token', {
        value: accessToken,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      next();
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any).code === 'verify_access_token_error') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return sendBearerError(res, 401, 'invalid_token', (error as any).message);
      }

      return sendBearerError(res, 401, 'invalid_token', 'Invalid token');
    }
  };
}

// Everything below runs only on a router created with the `poppy` option.

const POPPY_OPTION_WITHOUT_POPPY_ROUTER =
  'requiresAuth() was given the poppy option, but createAuth0Api() was not. Set the poppy option of createAuth0Api() to verify Poppy Sessions.';

// The text of the error that `next()` gets for anything unexpected. The cause goes in `cause`, never in the text.
const POPPY_REQUEST_FAILED = 'The request could not be verified.';

// The pattern `@auth0/auth0-api-js` reads the `Authorization` header with, so the token is the credential it verified.
const CREDENTIAL_PATTERN = /^(Bearer|DPoP) (.+)$/i;

// The cause of the error that `next()` gets for a `scopes` option that is not empty but names no scope.
const BLANK_SCOPES =
  'The scopes option of requiresAuth() is not empty, but it names no scope. Leave it out for a route that needs no scope.';

/**
 * `requiresAuth()` for a router created with the `poppy` option.
 *
 * `verifyPoppyRequest()` of the `ApiClient` verifies the `Poppy-Session` header and the access token together. This
 * decides from the two things it returns, a verified Session (`poppy`) and the claims of a verified access token
 * (`claims`), and from nothing else that the request says. It reads the `Authorization` header only once there are
 * claims, to hand the token on as `req.auth0.token`. The route runs for verified claims that have the scopes it needs,
 * and for a verified Session on a route that sets `requireSession` and has no scopes. Any other request is answered
 * here, and anything unexpected ends in an error for `next()`, such as a `null` part, or claims without the Session
 * that a `requireSession` route needs. So a request never goes on unverified, and this promise never rejects, which
 * Express 4 would not catch.
 */
async function requiresPoppyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  apiClient: ApiClient,
  options: RequiresAuthOptions
): Promise<void> {
  let proceed: boolean;

  try {
    proceed = await verifyAndAnswer(req, res, apiClient, options);
  } catch (error) {
    // The app's error handler gets a fixed text and a 500, and the original in `cause` to log. The agent never sees it.
    next(Object.assign(new Error(POPPY_REQUEST_FAILED, { cause: error }), { status: 500 }));
    return;
  }

  // Outside the `try` on purpose: a throw further down the chain is no failed check, and must not be answered as one.
  if (proceed) {
    next();
  }
}

/**
 * Verifies the request, then either answers it or leaves it to the route. It resolves to `true` only when the route may
 * run, and `false` once it has answered. It rejects when it can do neither, for the caller to turn into an error.
 */
async function verifyAndAnswer(
  req: Request,
  res: Response,
  apiClient: ApiClient,
  options: RequiresAuthOptions
): Promise<boolean> {
  const requireSession = options.poppy?.requireSession === true;
  // A mistake of the route, the same for every request, so it is found before anything is verified.
  assertScopesNameAScope(options.scopes);
  let result: VerifiedPoppyRequest;

  try {
    result = await apiClient.verifyPoppyRequest({
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requireSession,
    });
  } catch (error) {
    // A Session or access token error has a response to send. Any other error is not a failure of the request.
    sendHttpError(res, error);
    return false;
  }

  const { poppy, claims } = result;

  // `verifyPoppyRequest` leaves out a part that the request does not have, and never returns `null` for one. A result
  // that does is not one it returns, so nothing in it is trusted, and the request does not go on.
  if (claims === null || poppy === null) {
    throw new Error('verifyPoppyRequest returned null for the claims or for the Session.');
  }

  const scope = splitScopes(options.scopes);

  if (claims !== undefined) {
    // A route that sets `requireSession` reads `req.auth0.poppy`, and `verifyPoppyRequest` refuses a request without a
    // Session there. Claims without one are not a result it returns, so the route must not run, whatever the scopes.
    if (requireSession && poppy === undefined) {
      throw new Error('verifyPoppyRequest returned claims without the Session that the route requires.');
    }

    if (scope.length > 0 && !validateScopes(claims as Token, scope)) {
      sendBearerError(res, 403, 'insufficient_scope', 'Insufficient scopes', scope);
      return false;
    }

    // Read before anything is set on `req.auth0`, so that a request that cannot go on leaves it as it was.
    const accessToken = CREDENTIAL_PATTERN.exec(req.headers.authorization ?? '')?.[2];

    if (accessToken === undefined) {
      throw new Error(
        'The access token was verified, but the Authorization header holds no Bearer or DPoP credential.'
      );
    }

    req.auth0.user = claims as Token;
    // Non-enumerable, so logging or serialising `req.auth0` cannot leak it.
    Object.defineProperty(req.auth0, 'token', {
      value: accessToken,
      enumerable: false,
      writable: true,
      configurable: true,
    });

    if (poppy !== undefined) {
      req.auth0.poppy = poppy;
    }

    return true;
  }

  if (poppy !== undefined && scope.length > 0) {
    // A Session without an access token cannot reach a route that needs scopes. The challenges name the scopes, so that
    // the agent can sign in for them.
    sendHttpError(res, new SignInRequiredError({ scope }));
    return false;
  }

  if (poppy !== undefined && requireSession) {
    req.auth0.poppy = poppy;
    return true;
  }

  // Nothing above lets the request through, so it is refused as a request with no access token is without Poppy.
  res.status(401).header('WWW-Authenticate', 'Bearer').end();
  return false;
}

/**
 * The scopes of a route as a list of single scopes: a string is split on spaces, and an empty piece is not a scope. An
 * empty list means the route needs no scope.
 */
function splitScopes(scopes: RequiresAuthOptions['scopes']): string[] {
  return [scopes ?? []]
    .flat()
    .flatMap((entry) => entry.split(' '))
    .filter((scope) => scope !== '');
}

/**
 * Throws for a `scopes` option that is not empty but names no scope, such as `' '` or `['']`. `''` and `[]` say that
 * the route needs no scope. These say nothing, which can only be a mistake of the route, such as a list built from a
 * setting that came out empty. A router without `poppy` refuses every request to such a route, so this one must not
 * open it. The error ends in the fixed error for `next()`, as a scope with a double quote does.
 */
function assertScopesNameAScope(scopes: RequiresAuthOptions['scopes']): void {
  if (scopes?.length && splitScopes(scopes).length === 0) {
    throw new Error(BLANK_SCOPES);
  }
}

/**
 * Answers with the response `toHttpErrorResponse()` gives for `error`: its status, its headers (such as
 * `WWW-Authenticate` and `Retry-After`) and, for a Session error, a JSON body. An error without one is not a failure of
 * the request, so it is thrown again, unanswered.
 */
function sendHttpError(res: Response, error: unknown): void {
  const response = toHttpErrorResponse(error);

  if (response === undefined) {
    throw error;
  }

  res.status(response.status).set(response.headers);

  if (response.body === undefined) {
    res.end();
  } else {
    res.json(response.body);
  }
}
