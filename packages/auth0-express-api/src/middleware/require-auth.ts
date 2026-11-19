import { Request, Response, NextFunction } from 'express';
import type { RequiresAuthOptions, Token } from '../types.js';
import { sendBearerError } from './claim-auth.js';
import { SignInRequiredError, toHttpErrorResponse } from '@auth0/auth0-api-js';
import type { ApiClient, VerifiedPoppyRequest } from '@auth0/auth0-api-js';
import { isPoppyClient } from '../poppy/poppy-clients.js';
import { printable, sendNoCredentials } from '../poppy/challenges.js';

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
    // Express 4 ignores a rejected promise, so anything that throws while
    // answering goes to `next()` instead.
    try {
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

      let token: Token;

      try {
        token = (await apiClient.verifyAccessToken({ accessToken })) as Token;
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((error as any).code === 'verify_access_token_error') {
          // The message can hold text from the request, such as the name of an unknown `crit` entry of the token.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return sendBearerError(res, 401, 'invalid_token', (error as any).message, undefined, { fromRequest: true });
        }

        return sendBearerError(res, 401, 'invalid_token', 'Invalid token');
      }

      let scopesAllowed = true;

      if (options.scopes) {
        try {
          scopesAllowed = validateScopes(token, options.scopes);
        } catch {
          // A `scope` claim that is neither a string nor a list cannot be read. Auth0 never issues one. As in 1.0.0, the
          // token is answered as an invalid token, and the error handler of the app is not called.
          return sendBearerError(res, 401, 'invalid_token', 'Invalid token');
        }
      }

      if (!scopesAllowed) {
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
      // Outside the verification `try`, so that an error thrown from here is not answered as a failed token. It goes to
      // the outer catch, and so to `next(error)`.
      next();
    } catch (error) {
      next(error);
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
 * claims, to hand the token on as `req.auth0.token`. The route runs for verified claims that have the scopes it needs
 * (and, on a route that sets `requireAccount`, are not the token of a guest), and for a verified Session on a route
 * that sets `requireSession`, has no scopes and does not set `requireAccount`. Any other request is answered
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
  // Mistakes of the route, the same for every request, so they are found before anything is verified.
  assertRequireAccountIsBoolean(options.poppy?.requireAccount);
  const requireAccount = options.poppy?.requireAccount === true;
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

    // The access token of a guest, an anonymous user whom the agent joined to a web app, is a valid token, and has the
    // scopes the tenant grants to guests. It is no account, so a route that needs one answers it as a request that has
    // none yet. This comes before the scopes, because the guest cannot fix a missing scope without signing in. A
    // machine token (client credentials) is not a guest, and passes: nothing in it says it is not an account.
    // It fails closed: any Session that is not signed in is refused, and so is a token that carries the guest markers,
    // whether or not api-js found a Session in it (the markers of Anonymous Sessions are the same, and `act` is a beta
    // claim whose members can change).
    if (requireAccount && ((poppy !== undefined && poppy.state !== 'signed_in') || isGuestToken(claims as Token))) {
      sendAccountRequired(res, scope);
      return false;
    }

    if (scope.length > 0 && !validateScopes(claims as Token, scope)) {
      sendBearerError(res, 403, 'insufficient_scope', 'Insufficient scopes', scope, { dpop: true });
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

  // A Session alone is no account, so a route that needs one never runs for it, whatever `requireSession` says.
  if (poppy !== undefined && requireSession && !requireAccount) {
    req.auth0.poppy = poppy;
    return true;
  }

  // Nothing above lets the request through, so it is refused as a request with no access token is.
  sendNoCredentials(res);
  return false;
}

/**
 * Answers a request that carries no account where the route needs one: the sign-in challenges that name the scopes of
 * the route, or, for a route without scopes, the answer for a request with no credentials.
 */
function sendAccountRequired(res: Response, scope: string[]): void {
  if (scope.length > 0) {
    sendHttpError(res, new SignInRequiredError({ scope }));
  } else {
    sendNoCredentials(res);
  }
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

const INVALID_REQUIRE_ACCOUNT =
  'The requireAccount option of requiresAuth() must be true or false. A value that is not a boolean could leave a route that needs an account open to a guest.';

const INVALID_SCOPE =
  'A scope of requiresAuth() must not contain a double quote, a backslash, a space or a character outside printable ASCII, as no scope token of RFC 6749 does.';

/**
 * Throws for a `requireAccount` that is set and is not a boolean, such as `'true'` or `1`. A route that reads it from a
 * setting would otherwise lose the check without any message. The error ends in the fixed error for `next()`, as a
 * blank `scopes` does.
 */
function assertRequireAccountIsBoolean(requireAccount: unknown): void {
  if (requireAccount !== undefined && typeof requireAccount !== 'boolean') {
    throw new Error(INVALID_REQUIRE_ACCOUNT);
  }
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
  // The same rule for every request, so a scope that no challenge can hold is found at once, and not only by the
  // request that happens to need the challenge.
  if (splitScopes(scopes).some((scope) => !SCOPE_TOKEN.test(scope))) {
    throw new Error(INVALID_SCOPE);
  }
}

// A scope token of RFC 6749 (section 3.3): printable ASCII without space, double quote and backslash.
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

const GUEST_SUBJECT_PREFIX = 'anon_poppy@';
const ANONYMOUS_SUBJECT_PROFILE = 'urn:auth0:anonymous_user';

/**
 * Whether the claims of a verified access token are the ones of a guest, an anonymous user: `sub_profile` lists
 * `urn:auth0:anonymous_user`, or `sub` starts with `anon_poppy@`. These are the two markers that `@auth0/auth0-api-js`
 * reads, and Auth0 sends `sub_profile` as a string of words. This check also reads a list of words, which api-js does
 * not, so it is the stricter of the two for that token and `requireAccount` refuses it. api-js reads the markers only
 * for a token that holds a Poppy Session, or that comes with a `Poppy-Session` header, so a token that carries the
 * markers and no Session would reach the route as an account without this check. Only the claims of the token itself are
 * read, never `act`.
 */
function isGuestToken(claims: Token): boolean {
  const profile: unknown = claims.sub_profile;
  const words = typeof profile === 'string' ? profile.split(/\s+/) : Array.isArray(profile) ? profile : [];

  return (
    words.includes(ANONYMOUS_SUBJECT_PROFILE) ||
    (typeof claims.sub === 'string' && claims.sub.startsWith(GUEST_SUBJECT_PREFIX))
  );
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

  // The text of a challenge can come from the client (a library error that quotes a JWT header, for example), and a
  // header cannot hold a control character: `set` would throw, and the request would end as a 500. So every character
  // outside printable ASCII becomes `?`.
  const headers = Object.fromEntries(
    Object.entries(response.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.map(printable) : printable(String(value)),
    ])
  );

  res.status(response.status).set(headers);

  if (response.body === undefined) {
    res.end();
  } else {
    res.json(response.body);
  }
}
