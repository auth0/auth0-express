/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { ExpressCookieHandler } from './express-cookie-handler.js';
import type { StoreOptions } from '../types.js';

function createStoreOptions(): StoreOptions {
  return {
    request: { cookies: {} } as any,
    response: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
  };
}

describe('ExpressCookieHandler', () => {
  describe('setCookie', () => {
    it('converts maxAge from seconds to milliseconds', () => {
      const handler = new ExpressCookieHandler();
      const storeOptions = createStoreOptions();

      handler.setCookie('session', 'value', { maxAge: 3600 }, storeOptions);

      expect(storeOptions.response.cookie).toHaveBeenCalledWith('session', 'value', {
        maxAge: 3_600_000,
      });
    });

    it('should ensure 0 remains 0', () => {
      const handler = new ExpressCookieHandler();
      const storeOptions = createStoreOptions();

      handler.setCookie('session', 'value', { maxAge: 0 }, storeOptions);
      
      expect(storeOptions.response.cookie).toHaveBeenCalledWith('session', 'value', {
        maxAge: 0,
      });
    });

    it('sets maxAge to undefined when not provided', () => {
      const handler = new ExpressCookieHandler();
      const storeOptions = createStoreOptions();

      handler.setCookie('session', 'value', {}, storeOptions);

      expect(storeOptions.response.cookie).toHaveBeenCalledWith('session', 'value', {
        maxAge: undefined,
      });
    });

    it('passes other options through unchanged', () => {
      const handler = new ExpressCookieHandler();
      const storeOptions = createStoreOptions();

      handler.setCookie('session', 'value', { maxAge: 60, httpOnly: true, secure: true, path: '/' }, storeOptions);

      expect(storeOptions.response.cookie).toHaveBeenCalledWith('session', 'value', {
        maxAge: 60_000,
        httpOnly: true,
        secure: true,
        path: '/',
      });
    });
  });

  describe('getCookie', () => {
    it('returns the cookie value from the request', () => {
      const handler = new ExpressCookieHandler();
      const storeOptions = createStoreOptions();
      storeOptions.request.cookies = { session: 'abc123' };

      const value = handler.getCookie('session', storeOptions);

      expect(value).toBe('abc123');
    });

    it('returns undefined for a missing cookie', () => {
      const handler = new ExpressCookieHandler();
      const storeOptions = createStoreOptions();

      const value = handler.getCookie('missing', storeOptions);

      expect(value).toBeUndefined();
    });
  });

  describe('getCookies', () => {
    it('returns all cookies from the request', () => {
      const handler = new ExpressCookieHandler();
      const storeOptions = createStoreOptions();
      storeOptions.request.cookies = { session: 'abc', other: 'xyz' };

      const cookies = handler.getCookies(storeOptions);

      expect(cookies).toEqual({ session: 'abc', other: 'xyz' });
    });
  });

  describe('deleteCookie', () => {
    it('calls clearCookie on the response', () => {
      const handler = new ExpressCookieHandler();
      const storeOptions = createStoreOptions();

      handler.deleteCookie('session', storeOptions);

      expect(storeOptions.response.clearCookie).toHaveBeenCalledWith('session');
    });
  });
});
