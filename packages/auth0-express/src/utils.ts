import { CookieTransactionStore, ServerClient, StatefulStateStore, StatelessStateStore } from '@auth0/auth0-server-js';
import { Auth0Options, StoreOptions } from './types.js';
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
 * Ensures the value does not have any leading slashes.
 * If it does, it will trim all of them.
 * @param value The value to ensure has no leading slashes.
 * @returns The value without leading slashes.
 */
function ensureNoLeadingSlash(value: string) {
  return value.replace(/^\/+/, '');
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
  const normalized = ensureNoLeadingSlash(url);

  if (normalized !== url.replace(/^\//, '')) {
    throw new Error(`Invalid route configuration: '${url}' contains multiple leading slashes`);
  }

  const result = new URL(normalized, baseUrl);
  if (result.origin !== baseUrl.origin) {
    throw new Error('URL is not allowed: origin does not match base URL');
  }
  return result;
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

export function createServerClientInstance(options: Auth0Options) {
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
