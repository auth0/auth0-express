import { CookieTransactionStore, ServerClient, StatefulStateStore, StatelessStateStore } from '@auth0/auth0-server-js';
import type { DomainResolver } from '@auth0/auth0-server-js';
import { Auth0Options, StoreOptions } from './types.js';
import { ExpressCookieHandler } from './store/express-cookie-handler.js';
import { MigrationStatelessStateStore } from './store/legacy-compatible-stateless-state-store.js';
import { MigrationStatefulStateStore } from './store/legacy-compatible-stateful-state-store.js';
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

// Matches only URLs with an authority component (e.g. https://, http://, file://).
// Bare-scheme inputs like `javascript:alert(1)` or `report:summary` do NOT match
// and are treated as relative paths — resolved safely against the base URL.
const AUTHORITY_URL_REGEX = /^[a-zA-Z][a-zA-Z0-9.+-]*:\/\//;

// Matches any scheme-like prefix (e.g. `javascript:`, `data:`, `report:`).
// Used to detect first-segment colons that would confuse the WHATWG URL parser
// when resolving relative paths, so we can prefix them with `./`.
const SCHEME_PREFIX_REGEX = /^[a-zA-Z][a-zA-Z0-9.+-]*:/;

// Schemes that must never be used as a redirect or route destination.
// These can execute code or render arbitrary content in a browser.
const UNSAFE_SCHEME_REGEX = /^(javascript|data|vbscript):/i;

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
 * Accepts a relative path or an absolute same-origin URL, such as one forwarded by a reverse proxy.
 * Validates that the constructed URL has the same origin as the base URL to prevent host override attacks.
 * @param url Relative path (e.g. `/auth/callback`) or absolute same-origin URL.
 * @param base The base URL to use, including any subpath.
 * @returns A URL object, combining the base and url.
 * @throws {Error} If the input contains multiple leading slashes/backslashes or the origin does not match the base URL.
 */
export function createRouteUrl(url: string, base: string) {
  const baseUrl = new URL(ensureTrailingSlash(base));

  if (AUTHORITY_URL_REGEX.test(url)) {
    // Absolute URL with authority (https://, http://, file://, etc.).
    // Resolve against the base so the subpath is validated, then check origin.
    let absolute: URL;
    try {
      absolute = new URL(url);
    } catch {
      throw new Error(`URL is not allowed: '${url}' is not a valid URL`);
    }
    if (absolute.origin !== baseUrl.origin) {
      throw new Error('URL is not allowed: origin does not match base URL');
    }
    return absolute;
  }

  const normalized = ensureNoLeadingSlash(url);

  if (normalized !== url.replace(/^[/\\]/, '')) {
    throw new Error(`Invalid route configuration: '${url}' contains multiple leading slashes or backslashes`);
  }

  if (UNSAFE_SCHEME_REGEX.test(normalized)) {
    throw new Error(`URL is not allowed: '${url}' uses an unsafe scheme`);
  }

  // Prepend `./` when the normalized path starts with a scheme-like prefix
  // (e.g. `report:summary`) so the WHATWG URL parser treats it as a relative
  // path rather than a scheme.
  const resolvable = SCHEME_PREFIX_REGEX.test(normalized) ? `./${normalized}` : normalized;

  const result = new URL(resolvable, baseUrl);
  if (result.origin !== baseUrl.origin) {
    throw new Error('URL is not allowed: origin does not match base URL');
  }
  return result;
}

/**
 * Validates a user-supplied redirect URL (e.g. a `returnTo` query parameter) against the application base URL.
 * Accepts relative paths and absolute same-origin URLs. Rejects different-origin URLs and injection attempts.
 * Never throws — returns undefined for any invalid or unsafe input.
 * @param dangerousRedirect Untrusted redirect URL from user input.
 * @param safeBaseUrl The base URL to check against.
 * @returns A safe redirect URL, or undefined if the input is not safe.
 */
export function toSafeRedirect(dangerousRedirect: string, safeBaseUrl: string): string | undefined {
  try {
    // createRouteUrl validates origin for both absolute and relative inputs.
    // Using it for both branches avoids duplicating AUTHORITY_URL_REGEX logic here
    // and ensures subpath preservation for relative paths in subpath deployments.
    return createRouteUrl(dangerousRedirect, safeBaseUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * Factory function to create the appropriate state store based on the provided options.
 * @param options The Auth0 options to determine which state store to create and configure.
 * @returns An instance of a state store: stateful, stateless, or their legacy-compatible variants.
 */
function getStateStore(options: Auth0Options) {
  const isLegacy = options.legacyCompatibility !== undefined;

  if (options.sessionStore) {
    // Use stateful store with custom session store (Redis, MongoDB, etc.)
    if (isLegacy) {
      // Legacy-compatible stateful store for express-openid-connect migration
      return new MigrationStatefulStateStore(
        {
          secret: options.sessionSecret,
          store: options.sessionStore,
          legacySecret: options.legacyCompatibility?.legacySecret,
          legacyAudience: options.legacyCompatibility?.legacyAudience,
          legacyScope: options.legacyCompatibility?.legacyScope,
          requireSignedLegacyCookie: options.legacyCompatibility?.requireSignedLegacyCookie,
          sessionConfiguration: options.sessionConfiguration,
        },
        new ExpressCookieHandler()
      );
    }

    // Standard stateful store
    return new StatefulStateStore(
      {
        ...options.sessionConfiguration,
        secret: options.sessionSecret,
        store: options.sessionStore,
      },
      new ExpressCookieHandler()
    );
  }

  if (isLegacy) {
    // Legacy-compatible stateless store for express-openid-connect migration
    return new MigrationStatelessStateStore(
      {
        secret: options.sessionSecret,
        legacySecret: options.legacyCompatibility?.legacySecret,
        legacyAudience: options.legacyCompatibility?.legacyAudience,
        legacyScope: options.legacyCompatibility?.legacyScope,
        sessionConfiguration: options.sessionConfiguration,
      },
      new ExpressCookieHandler()
    );
  }

  // Standard stateless store
  return new StatelessStateStore(
    {
      ...options.sessionConfiguration,
      secret: options.sessionSecret,
    },
    new ExpressCookieHandler()
  );
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

  const isEC = !!options.enterpriseConnect;

  return new ServerClient<StoreOptions>({
    domain: wrapDomainResolver(options.domain),
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    clientAssertionSigningKey: options.clientAssertionSigningKey,
    clientAssertionSigningAlg: options.clientAssertionSigningAlg,
    enterpriseConnect: isEC || undefined,
    authorizationParams: {
      audience: options.audience,
      redirect_uri: redirectUri,
    },
    transactionStore: new CookieTransactionStore({ secret: options.sessionSecret }, new ExpressCookieHandler()),
    // In EC mode, server-js uses NullStateStore automatically; do not pass stateStore.
    stateStore: isEC ? undefined : getStateStore(options),
    stateIdentifier: options.sessionConfiguration?.cookie?.name,
    customFetch: options.customFetch,
    discoveryCache: options.discoveryCache,
  });
}
