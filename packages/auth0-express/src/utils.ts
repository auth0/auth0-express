import { CookieTransactionStore, ServerClient, StatefulStateStore, StatelessStateStore } from '@auth0/auth0-server-js';
import type { DomainResolver } from '@auth0/auth0-server-js';
import { Auth0Options, StoreOptions } from './types.js';
import { ExpressCookieHandler } from './store/express-cookie-handler.js';
import { getRequestContext } from './store/request-context.js';

/**
 * Ensures the value has a trailing slash.
 * If it does not, it will append one.
 * @param value The value to ensure has a trailing slash.
 * @returns The value with a trailing slash.
 */
function ensureTrailingSlash(value: string) {
  return value && !value.endsWith('/') ? `${value}/` : value;
}

/**
 * Ensures the value does not have any leading slashes or backslashes.
 * If it does, it will trim all of them.
 * @param value The value to ensure has no leading slashes or backslashes.
 * @returns The value without leading slashes or backslashes.
 */
function ensureNoLeadingSlash(value: string) {
  return value.replace(/^[/\\]+/, '');
}

const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9.+-]*:/;

/**
 * Wraps a user-provided domain resolver so it always receives the Express
 * request context. `@auth0/auth0-server-js` invokes the resolver with the
 * `storeOptions` passed to client methods; this SDK relies on
 * `AsyncLocalStorage` instead of passing them explicitly, so when
 * `storeOptions` is absent we recover it via `getRequestContext()` — the same
 * fallback used by `ExpressCookieHandler`.
 *
 * A static string domain is returned unchanged.
 */
export function wrapDomainResolver(
  domain: Auth0Options['domain']
): string | DomainResolver<StoreOptions> {
  if (typeof domain === 'string') {
    return domain;
  }

  return (storeOptions?: StoreOptions) => domain(storeOptions ?? getRequestContext());
}

/**
 * Utility function to ensure Route URLs are created correctly when using both the root and subpath as base URL.
 * Validates that the constructed URL has the same origin as the base URL to prevent host override attacks.
 * @param url The URL to use.
 * @param base The base URL to use.
 * @returns A URL object, combining the base and url.
 * @throws {Error} If the constructed URL origin does not match the base URL origin.
 */
export function createRouteUrl(url: string, base: string) {
  const baseUrl = new URL(ensureTrailingSlash(base));

  if (SCHEME_REGEX.test(url)) {
    const absolute = new URL(url);
    if (absolute.origin !== baseUrl.origin) {
      throw new Error('URL is not allowed: origin does not match base URL');
    }
    return absolute;
  }

  const normalized = ensureNoLeadingSlash(url);

  if (normalized !== url.replace(/^[/\\]/, '')) {
    throw new Error(`Invalid route configuration: '${url}' contains multiple leading slashes or backslashes`);
  }

  const result = new URL(normalized, baseUrl);
  if (result.origin !== baseUrl.origin) {
    throw new Error('URL is not allowed: origin does not match base URL');
  }
  return result;
}

/**
 * Function to ensure a redirect URL is safe to use, as in, it has the same origin as the safeBaseUrl.
 * Accepts both absolute same-origin URLs and relative paths.
 * @param dangerousRedirect The redirect URL to check.
 * @param safeBaseUrl The base URL to check against.
 * @returns A safe redirect URL or undefined if the redirect URL is not safe.
 */
export function toSafeRedirect(dangerousRedirect: string, safeBaseUrl: string): string | undefined {
  try {
    const safeOrigin = new URL(safeBaseUrl).origin;
    // Absolute URLs are validated by origin check directly.
    // Relative paths go through createRouteUrl rather than new URL(input, base) because
    // new URL() treats a leading slash as origin-absolute, dropping the subpath in
    // subpath deployments.
    const url = SCHEME_REGEX.test(dangerousRedirect)
      ? new URL(dangerousRedirect)
      : createRouteUrl(dangerousRedirect, safeBaseUrl);
    return url.origin === safeOrigin ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function createServerClientInstance(options: Auth0Options) {
  const callbackPath = options.routes?.callback ?? '/auth/callback';
  // Only a static string base URL yields a startup redirect_uri. In dynamic
  // (undefined) or allow-list (array) mode, the login handler sets redirect_uri
  // per request from the resolved base URL.
  const staticAppBaseUrl = typeof options.appBaseUrl === 'string' ? options.appBaseUrl : undefined;
  const redirectUri = staticAppBaseUrl
    ? createRouteUrl(callbackPath, staticAppBaseUrl).toString()
    : undefined;

  return new ServerClient<StoreOptions>({
    domain: wrapDomainResolver(options.domain),
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    clientAssertionSigningKey: options.clientAssertionSigningKey,
    clientAssertionSigningAlg: options.clientAssertionSigningAlg,
    authorizationParams: {
      audience: options.audience,
      redirect_uri: redirectUri,
    },
    transactionStore: new CookieTransactionStore({ secret: options.sessionSecret }, new ExpressCookieHandler()),
    stateStore: options.sessionStore
      ? new StatefulStateStore(
          {
            ...options.sessionConfiguration,
            secret: options.sessionSecret,
            store: options.sessionStore,
          },
          new ExpressCookieHandler()
        )
      : new StatelessStateStore(
          {
            ...options.sessionConfiguration,
            secret: options.sessionSecret,
          },
          new ExpressCookieHandler()
        ),
    stateIdentifier: options.sessionConfiguration?.cookie?.name,
    customFetch: options.customFetch,
    discoveryCache: options.discoveryCache,
  });
}
