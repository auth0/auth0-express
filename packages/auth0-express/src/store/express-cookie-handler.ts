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

  deleteCookie(name: string, storeOptions?: StoreOptions, options?: CookieSerializeOptions): void {
    const { response } = storeOptions ?? getRequestContext();

    // A browser ignores a `Set-Cookie` that has a `__Host-` or `__Secure-` name and no `Secure` attribute, and that
    // includes the header that clears the cookie. So `secure` goes along with `path` and `domain`, and so do `httpOnly`
    // and `sameSite`, which a cookie of the same name was set with. `maxAge` and `expires` do not: Express sets them.
    response.clearCookie(
      name,
      options
        ? {
            path: options.path,
            domain: options.domain,
            secure: options.secure,
            httpOnly: options.httpOnly,
            sameSite: options.sameSite,
          }
        : undefined
    );
  }
}
