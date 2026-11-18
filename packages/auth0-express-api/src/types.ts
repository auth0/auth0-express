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
   * A scope must be a scope token of RFC 6749: printable ASCII with no space, no double quote (`"`) and no backslash.
   * On a router created with the `poppy` option, a route with a scope that is not one ends in the same `500` error for
   * every request, so the mistake shows at once and no malformed challenge is sent.
   */
  scopes?: string | string[];
  /**
   * Options for a route of an API that serves Personal Agents, as the Poppy (Personal Agent Protocol) 1.0 specification
   * describes them: software that acts for a user and proves who it is with a signed `Poppy-Session` header. They apply
   * only to a router created with the `poppy` option of {@link createAuth0Api}. On any other router `requiresAuth()`
   * passes an error to `next()` on every request, so the mistake shows at once.
   *
   * On a router created with the `poppy` option, `requiresAuth()` answers a request as follows:
   * - A valid access token that has the `scopes` of the route: the route runs, with the claims of the token as
   *   `req.auth0.user`, and the Session as `req.auth0.poppy` when the request has one. The token of a guest (see
   *   `requireAccount`) runs the route too, when it has the scopes: set `requireAccount` on a route that needs a real
   *   account.
   * - A valid Session and no access token, as from a Personal Agent whose user has not signed in: `401`, like a request
   *   with no credentials, and the route does not run. When the route has `scopes`, the `WWW-Authenticate` challenges
   *   name them, so the agent knows what to sign in for. `requireSession` lets such a request through, on a route
   *   without `scopes`.
   * - A bad Session or a bad access token: the error response the specification asks for, such as `400` with
   *   `{"error": "invalid_session"}`. The route does not run.
   *
   * @see {@link https://personalagentprotocol.org/docs/1.0/spec Poppy 1.0 specification}
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
     * A route that also sets `requireAccount` does not let a Session without an access token through: a Session alone is
     * no account.
     *
     * @defaultValue `false`
     * @beta
     */
    requireSession?: boolean;

    /**
     * Whether the route must not run for a guest, and not only for a request without a valid access token. Set it on a
     * route that acts for the account, such as one that places an order or reads a profile.
     *
     * A guest is an anonymous user whom a Personal Agent joined to your web app before they signed in. The guest gets
     * an access token that is valid, is for your API and has the scopes that your tenant grants to guests, but it has
     * no account behind it: its `sub` names the guest, and `req.auth0.poppy.state` is `signed_out`. A route that checks
     * only `scopes` runs for it, whenever a guest holds those scopes. With `requireAccount: true`, such a request is
     * answered like one that needs to sign in: `401` and the `WWW-Authenticate` challenges that name the `scopes` of the
     * route, or, for a route without `scopes`, a plain `401` with a challenge for each scheme. The route does not run.
     *
     * What it refuses: a token with a Session that is not signed in, a token that carries the guest markers whether or
     * not it holds a Session (`sub_profile` lists `urn:auth0:anonymous_user`, or `sub` starts with `anon_poppy@`: the
     * tokens of Anonymous Sessions have them too), and a Session without an access token, even on a route that sets
     * `requireSession`. What it lets through: any other valid access token, with or without a Session. That includes
     * a machine token (client credentials), so it is not a proof that a person signed in. Only a router created with
     * the `poppy` option has it: on any other router it ends in the `500` error that every `poppy` option ends in.
     *
     * It must be `true` or `false`. Any other value, such as the string `'true'`, ends in a `500` error passed to
     * `next()` for every request, so a setting that came out wrong cannot leave the route open to a guest.
     *
     * @defaultValue `false`
     * @beta
     */
    requireAccount?: boolean;
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
   *
   * With the `poppy` option, this is the only issuer the router accepts for the `aud` of a `Poppy-Session` header, as
   * `https://<domain>/`, and it is the issuer of the access tokens as before. The `aud` that an agent signs is the issuer that the `poppy.json` of your API selects, and
   * that depends on the host of the request, so set `domain` to the domain whose issuer `poppy.json` selects. When it
   * selects your custom domain, set the custom domain here, and not the canonical `tenant.auth0.com` domain, or every
   * request with a Session fails with `invalid_session`.
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
   * Support for Personal Agents (Poppy 1.0): software that acts for a user and signs its requests with a
   * `Poppy-Session` header. Set it when your API should serve them, with `verifySession: true`: otherwise a plain route
   * does not check the `Poppy-Session` header. `poppy: { publicOrigin }` turns Personal Agent support on and leaves
   * every other setting at its default, `verifySession` included. `publicOrigin` is required: the router passes only the path of each
   * request, so the public origin of your API has to come from there. See {@link Auth0ApiPoppyOptions} for the
   * settings.
   *
   * `createAuth0Api()` checks the options once, when it runs. It throws `InvalidConfigurationError` (from
   * `@auth0/auth0-api-js`) when an option is invalid, and when `publicOrigin` is missing. There is no environment
   * variable for this option.
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
   * Set `verifySession: true`. It is `false` by default, as in `@auth0/auth0-api-js` (it is `true` when you set
   * `agents`), and then a route that does not set `requireSession` ignores the `Poppy-Session` header: it is not
   * checked, so a forged one is not refused,
   * `req.auth0.poppy` is not set from it, and the access token of a registered agent is accepted without it.
   *
   * @defaultValue `undefined`. Personal Agent support is off, and requests are handled exactly as before.
   * @see {@link https://personalagentprotocol.org/docs/1.0/spec Poppy 1.0 specification}
   * @beta
   */
  poppy?: Auth0ApiPoppyOptions;
}

/**
 * Options for serving Personal Agents, as the Poppy (Personal Agent Protocol) 1.0 specification describes. Set them as
 * the `poppy` option of {@link Auth0ApiOptions}.
 *
 * A Personal Agent is software that acts for one user. It signs a `Poppy-Session` header on every request to your API,
 * naming the agent and a pseudonymous ID for the user. Once the user has signed in, its requests also carry an access
 * token.
 *
 * These are the `PoppyOptions` of `@auth0/auth0-api-js`: `verifySession`, `publicOrigin`, `agents`, `versions`,
 * `sessionStore`, `iatWindow` and `agentMetadata`. Each keeps its default when you leave it out, except `publicOrigin`,
 * which this package requires.
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
 * @see {@link https://personalagentprotocol.org/docs/1.0/spec Poppy 1.0 specification}
 * @beta
 */
export type Auth0ApiPoppyOptions = PoppyOptions;
