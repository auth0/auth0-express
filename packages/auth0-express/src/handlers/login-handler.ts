import { Request, Response, NextFunction } from 'express';
import { createRouteUrl, toSafeRedirect } from '../utils.js';
import { resolveAppBaseUrl } from '../app-base-url.js';
import { sanitizeHandlerError, sanitizePoppyHandlerError } from '../errors.js';
import { Auth0Options } from '../index.js';

// Block both Object.prototype own-property names and commonly abused
// prototype-pollution keys that are not own-properties of Object.prototype.
const DENIED_KEYS = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  '__proto__',
  'constructor',
  'prototype',
]);

// OAuth/OIDC protocol parameters that must be SDK-controlled, not user-supplied
const RESERVED_OAUTH_PARAMS = new Set([
  'response_type',
  'state',
  'code_challenge',
  'code_challenge_method',
  'client_id',
  'redirect_uri',
  'nonce',
  'scope',
  // Target-API params are one family: the transaction only records `audience`, so a link
  // supplying an alias (`resource`, etc.) would mint a token for that target while it is stored
  // under our own audience key, and `getAccessToken()` would later hand the app a token minted
  // for someone else's resource. Reserve the whole family, matching auth0-auth-js's denylist.
  'audience',
  'aud',
  'resource',
  'resources',
  'resource_indicator',
  // Request Objects and related params must be SDK/tenant-controlled, not
  // user-supplied via a login link. prompt/login_hint are
  // intentionally NOT reserved — integrators commonly forward them.
  'request',
  'request_uri',
  'id_token_hint',
  'claims',
  'response_mode',
  // Rich Authorization Requests: a crafted link must not be able to inject its own grant
  // details, which an app reading `authorizationDetails` in its callback would then act on.
  'authorization_details',
]);

/**
 * Filters out reserved OAuth parameters and any additional disallowed parameters from the input record.
 * This ensures that only safe, non-reserved parameters are included in the authorization request.
 * @param params The record of parameters to filter.
 * @param disallowed An array of parameter names that should be excluded.
 * @returns An object containing only the allowed parameters, or undefined if none are allowed.
 */
function filterAuthorizationParams(
  params: Record<string, unknown>,
  disallowed: string[]
): Record<string, unknown> | undefined {
  const filtered: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(params)) {
    if (!DENIED_KEYS.has(key) && !disallowed.includes(key) && !RESERVED_OAUTH_PARAMS.has(key)) {
      filtered[key] = value;
    }
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export async function handleLogin(req: Request, res: Response, options: Auth0Options, next: NextFunction): Promise<void> {
  try {
    const appBaseUrl = resolveAppBaseUrl(options.appBaseUrl, req);
    const callbackPath = options.routes?.callback ?? '/auth/callback';
    const redirectUri = createRouteUrl(callbackPath, appBaseUrl);

    const query = req.query as Record<string, unknown>;
    const dangerousReturnTo = query.returnTo as string | undefined;
    let sanitizedReturnTo = toSafeRedirect(dangerousReturnTo || '/', appBaseUrl);
    let disallowedParams = ['returnTo'];

    if (options.poppy) {
      // An agent's browser arrives here with `iss` and `target_link_uri` (OpenID Connect Core 1.0, section 4), and
      // anyone can send a browser here with any query. This check comes first, before anything writes a cookie: it
      // throws when `iss` is not the issuer, and it gives `target_link_uri` back as `returnTo` only when it is a page
      // of this app. Its `authorizationParams` are not used, because they are not filtered like the ones below.
      // https://openid.net/specs/openid-connect-core-1_0.html#ThirdPartyInitiatedLogin
      const initiation = req.auth0.client.poppy.parseLoginInitiation(new URL(req.originalUrl, appBaseUrl), {
        appOrigin: new URL(appBaseUrl).origin,
      });

      // A `returnTo` in the query that was accepted comes first, then the target, then the value that is used today.
      const acceptedReturnTo = dangerousReturnTo ? sanitizedReturnTo : undefined;
      sanitizedReturnTo = acceptedReturnTo ?? initiation.returnTo ?? sanitizedReturnTo;
      // `iss` and `target_link_uri` are for this route. They never go on to /authorize.
      disallowedParams = ['returnTo', 'iss', 'target_link_uri'];
    }

    const authorizationUrl = await req.auth0.client.startInteractiveLogin({
      pushedAuthorizationRequests: options.pushedAuthorizationRequests,
      appState: { returnTo: sanitizedReturnTo },
      authorizationParams: {
        ...filterAuthorizationParams(query, disallowedParams),
        redirect_uri: redirectUri.toString(),
      },
    });

    res.redirect(authorizationUrl.href);
  } catch (error) {
    next(options.poppy ? sanitizePoppyHandlerError(error) : sanitizeHandlerError(error));
  }
}
