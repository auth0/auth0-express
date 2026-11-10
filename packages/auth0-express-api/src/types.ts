import type { ActClaim, PoppyOptions } from '@auth0/auth0-api-js';

/**
 * Options for {@link requiresAuth}.
 */
export interface RequiresAuthOptions {
  /**
   * The scopes the access token must have, as one scope or a list. A request whose token lacks one is refused with
   * `403` and `insufficient_scope`.
   *
   * On a router created with the `poppy` option, a string is split on spaces, so `'orders:read orders:write'` stands
   * for two scopes, and an empty entry is ignored. `''` and `[]` mean that the route needs no scope. A value that is
   * not empty but holds no scope, such as `' '` or `['']`, ends in a `500` error passed to `next()` for every request,
   * so a scope list that came out blank cannot open a route. On any other router a string is one scope, and `['']` is
   * one scope that no token has, so a request is refused with `403`.
   *
   * A scope must not contain a double quote (`"`), as no scope token of RFC 6749 does: on a router created with the
   * `poppy` option, a request that has a Session and no access token then ends in the same `500` error.
   */
  scopes?: string | string[];
  /**
   * Options for a route of an API that serves Personal Agents, as the Poppy (Personal Agent Protocol) 0.3 specification
   * describes them: software that acts for a user and proves who it is with a signed `Poppy-Session` header. They apply
   * only to a router created with the `poppy` option of {@link createAuth0Api}. On any other router `requiresAuth()`
   * passes an error to `next()` on every request, so the mistake shows at once.
   *
   * On a router created with the `poppy` option, `requiresAuth()` answers a request as follows:
   * - A valid access token that has the `scopes` of the route: the route runs, with the claims of the token as
   *   `req.auth0.user`, and the Session as `req.auth0.poppy` when the request has one.
   * - A valid Session and no access token, as from a Personal Agent whose user has not signed in: `401`, like a request
   *   with no credentials, and the route does not run. When the route has `scopes`, the `WWW-Authenticate` challenges
   *   name them, so the agent knows what to sign in for. `requireSession` lets such a request through, on a route
   *   without `scopes`.
   * - A bad Session or a bad access token: the error response the specification asks for, such as `400` with
   *   `{"error": "invalid_session"}`. The route does not run.
   *
   * @see {@link https://personalagentprotocol.org/docs/0.3/spec Poppy 0.3 specification}
   * @beta
   */
  poppy?: {
    /**
     * Whether the route needs a Session, the signed `Poppy-Session` header of a Personal Agent. Set it on a route that
     * reads `req.auth0.poppy`, such as one that serves an agent before its user has signed in (a product list, or a
     * cart).
     *
     * When `true`, a request without a verified Session is refused with `400` and `{"error": "invalid_session"}`, and
     * the header is checked even when `verifySession` is off in the `poppy` option of {@link createAuth0Api}. A request
     * with a valid Session and no access token then runs the route, with the Session as `req.auth0.poppy` and no
     * `req.auth0.user`. A route with `scopes` still needs an access token, so such a request gets `401` there.
     *
     * When `false`, a request without an access token gets `401` and does not run the route, whatever its (valid)
     * Session.
     *
     * @defaultValue `false`
     * @beta
     */
    requireSession?: boolean;
  };
}

export interface Token {
  sub: string;
  aud: string | string[];
  iss: string;
  scope?: string;
  /**
   * The RFC 8693 actor claim, present when this token was obtained through a
   * token exchange. Pass the token to `getCurrentActor()` or
   * `getDelegationChain()` to read the delegation chain.
   */
  act?: ActClaim;

  [claim: string]: unknown;
}

export interface Auth0ApiOptions {
  /**
   * The auth0 domain (without https://).
   * Can be provided via AUTH0_DOMAIN environment variable.
   */
  domain?: string;
  /**
   * The audience for the API.
   * Can be provided via AUTH0_AUDIENCE environment variable.
   */
  audience?: string;
  /**
   * The optional client ID of the application.
   * Required when calling Auth0 as a client through `req.auth0.client`, for
   * example `getTokenOnBehalfOf()`.
   */
  clientId?: string;
  /**
   * The optional client secret of the application.
   * At least one of `clientSecret` or `clientAssertionSigningKey` is required
   * when calling Auth0 as a client through `req.auth0.client`.
   */
  clientSecret?: string;
  /**
   * The optional client assertion signing key to use.
   * At least one of `clientSecret` or `clientAssertionSigningKey` is required
   * when calling Auth0 as a client through `req.auth0.client`.
   */
  clientAssertionSigningKey?: string | CryptoKey;
  /**
   * The optional client assertion signing algorithm to use with the `clientAssertionSigningKey`.
   * If not provided, it will default to `RS256`.
   */
  clientAssertionSigningAlg?: string;
  /**
   * Optional, custom Fetch implementation to use.
   */
  customFetch?: typeof fetch;
  /**
   * Support for Personal Agents (Poppy 0.3): software that acts for a user and signs its requests with a
   * `Poppy-Session` header. Set it when your API should serve them, with `verifySession: true`: otherwise a plain route
   * does not check the `Poppy-Session` header. `poppy: {}` turns Personal Agent support on and leaves every setting at
   * its default, `verifySession` included. Set `publicOrigin` too: the router passes only the path of each request, so
   * the public origin of your API has to come from there. See {@link Auth0ApiPoppyOptions} for the settings.
   *
   * `createAuth0Api()` checks the options once, when it runs. It throws `InvalidConfigurationError` (from
   * `@auth0/auth0-api-js`) when an option is invalid. There is no environment variable for this option.
   *
   * With this option, {@link requiresAuth} checks each request before your route runs, with `verifyPoppyRequest()` of
   * the `ApiClient` from `@auth0/auth0-api-js`, which verifies the `Poppy-Session` header and the access token. A
   * request that fails a check gets the error response the specification asks for, and your route does not run. A
   * request that passes reaches your route with `req.auth0.user` set to the claims of its access token, when it has
   * one, and `req.auth0.poppy` set to its Session, when it has one. A Personal Agent whose user has not signed in sends
   * a Session and no access token. It gets `401`, unless the route sets `poppy: { requireSession: true }` and has no
   * `scopes`: it then reaches the route with `req.auth0.poppy` set and no `req.auth0.user` (see
   * {@link RequiresAuthOptions}). A route that does not use `requiresAuth()` is not checked.
   *
   * Set `verifySession: true`. It is `false` by default, as in `@auth0/auth0-api-js`, and then a route that does not
   * set `requireSession` ignores the `Poppy-Session` header: it is not checked, so a forged one is not refused,
   * `req.auth0.poppy` is not set from it, and the access token of a registered agent is accepted without it.
   *
   * @defaultValue `undefined`. Personal Agent support is off, and requests are handled exactly as before.
   * @see {@link https://personalagentprotocol.org/docs/0.3/spec Poppy 0.3 specification}
   * @beta
   */
  poppy?: Auth0ApiPoppyOptions;
}

/**
 * Options for serving Personal Agents, as the Poppy (Personal Agent Protocol) 0.3 specification describes. Set them as
 * the `poppy` option of {@link Auth0ApiOptions}.
 *
 * A Personal Agent is software that acts for one user. It signs a `Poppy-Session` header on every request to your API,
 * naming the agent and a pseudonymous ID for the user. Once the user has signed in, its requests also carry an access
 * token.
 *
 * These are the `PoppyOptions` of `@auth0/auth0-api-js`: `verifySession`, `publicOrigin`, `agents`, `sessionStore`,
 * `iatWindow` and `agentMetadata`. Each keeps its default when you leave it out.
 *
 * @example
 * ```ts
 * // Set verifySession: true, or a route that does not set requireSession does not check the Poppy-Session header.
 * // Set publicOrigin to the public origin of your API: the router passes only the path of each request.
 * createAuth0Api({
 *   poppy: {
 *     verifySession: true,
 *     publicOrigin: 'https://api.example.com',
 *     agents: ['https://agent.example/agent.json'],
 *   },
 * });
 * ```
 *
 * @see {@link https://personalagentprotocol.org/docs/0.3/spec Poppy 0.3 specification}
 * @beta
 */
export type Auth0ApiPoppyOptions = PoppyOptions;
