import { CookieTransactionStore, ServerClient, StatefulStateStore, StatelessStateStore } from '@auth0/auth0-server-js';
import { Auth0ExpressOptions, StoreOptions } from './types.js';
import { ExpressCookieHandler } from './store/express-cookie-handler.js';

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
 * Ensures the value does not have a leading slash.
 * If it does, it will trim it.
 * @param value The value to ensure has no leading slash.
 * @returns The value without a leading slash.
 */
function ensureNoLeadingSlash(value: string) {
  return value.startsWith('/') ? value.substring(1, value.length) : value;
}

/**
 * Utility function to ensure Route URLs are created correctly when using both the root and subpath as base URL.
 * @param url The URL to use.
 * @param base The base URL to use.
 * @returns A URL object, combining the base and url.
 */
export function createRouteUrl(url: string, base: string) {
  return new URL(ensureNoLeadingSlash(url), ensureTrailingSlash(base));
}

/**
 * Function to ensure a redirect URL is safe to use, as in, it has the same origin as the safeBaseUrl.
 * @param dangerousRedirect The redirect URL to check.
 * @param safeBaseUrl The base URL to check against.
 * @returns A safe redirect URL or undefined if the redirect URL is not safe.
 */
export function toSafeRedirect(dangerousRedirect: string, safeBaseUrl: string): string | undefined {
  let url: URL;

  try {
    url = createRouteUrl(dangerousRedirect, safeBaseUrl);
  } catch {
    return undefined;
  }

  if (url.origin === new URL(safeBaseUrl).origin) {
    return url.toString();
  }

  return undefined;
}

export function createServerClientInstance(options: Auth0ExpressOptions) {
  const callbackPath = options.routes?.callback ?? '/auth/callback';
  const redirectUri = createRouteUrl(callbackPath, options.appBaseUrl);
  
  return new ServerClient<StoreOptions>({
    domain: options.domain,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    clientAssertionSigningKey: options.clientAssertionSigningKey,
    clientAssertionSigningAlg: options.clientAssertionSigningAlg,
    authorizationParams: {
      audience: options.audience,
      redirect_uri: redirectUri.toString(),
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
  });
}
