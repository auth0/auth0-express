import { CookieHandler, CookieSerializeOptions } from '@auth0/auth0-server-js';
import { StoreOptions } from '../types.js';
import { getRequestContext } from './request-context.js';

/**
 * Express-specific cookie handler that uses AsyncLocalStorage to automatically
 * access the current request and response objects.
 *
 * This implementation supports both explicit storeOptions and AsyncLocalStorage context.
 * When storeOptions are provided, they take precedence. Otherwise, it falls back to
 * retrieving the request context from AsyncLocalStorage.
 */
export class ExpressCookieHandler implements CookieHandler<StoreOptions> {
  setCookie(name: string, value: string, options?: CookieSerializeOptions, storeOptions?: StoreOptions): void {
    const { response } = storeOptions ?? getRequestContext();

    // options.maxAge is in seconds, but Express expects milliseconds
    const maxAge = options?.maxAge != null ? options.maxAge * 1000 : undefined;

    response.cookie(name, value, { ...options, maxAge });
  }

  getCookie(name: string, storeOptions?: StoreOptions): string | undefined {
    const { request } = storeOptions ?? getRequestContext();
    return request.cookies?.[name];
  }

  getCookies(storeOptions?: StoreOptions): Record<string, string> {
    const { request } = storeOptions ?? getRequestContext();
    return request.cookies as Record<string, string>;
  }

  deleteCookie(name: string, storeOptions?: StoreOptions): void {
    const { response } = storeOptions ?? getRequestContext();
    response.clearCookie(name);
  }
}
