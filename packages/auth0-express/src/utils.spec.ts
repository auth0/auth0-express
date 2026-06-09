import { describe, expect, test } from 'vitest';
import { createRouteUrl, toSafeRedirect, wrapDomainResolver } from './utils.js';
import { runWithContext } from './store/request-context.js';
import type { Request, Response } from 'express';
import type { StoreOptions } from './types.js';

describe('createRouteUrl', () => {
  const BASE = 'https://myapp.com';
  const BASE_WITH_SUBPATH = 'https://myapp.com/subapp';

  test('combines a simple path with the base URL', () => {
    expect(createRouteUrl('/auth/callback', BASE).href).toBe('https://myapp.com/auth/callback');
  });

  test('combines a path without leading slash with the base URL', () => {
    expect(createRouteUrl('auth/callback', BASE).href).toBe('https://myapp.com/auth/callback');
  });

  test('preserves query parameters on the path', () => {
    expect(createRouteUrl('/auth/callback?code=abc&state=xyz', BASE).href).toBe(
      'https://myapp.com/auth/callback?code=abc&state=xyz'
    );
  });

  test('works correctly with a sub-path base URL', () => {
    expect(createRouteUrl('/auth/callback', BASE_WITH_SUBPATH).href).toBe(
      'https://myapp.com/subapp/auth/callback'
    );
  });

  test('throws when path has multiple leading slashes', () => {
    expect(() => createRouteUrl('///evil.com/auth/callback', BASE)).toThrow(
      "Invalid route configuration: '///evil.com/auth/callback' contains multiple leading slashes"
    );
    expect(() => createRouteUrl('///custom-auth/callback', BASE)).toThrow(
      "Invalid route configuration: '///custom-auth/callback' contains multiple leading slashes"
    );
  });

  test('does not throw for a single leading slash', () => {
    expect(createRouteUrl('/auth/callback', BASE).href).toBe('https://myapp.com/auth/callback');
  });

  test('does not throw for no leading slash', () => {
    expect(createRouteUrl('auth/callback', BASE).href).toBe('https://myapp.com/auth/callback');
  });

  test('throws when path is an absolute URL with a scheme', () => {
    expect(() => createRouteUrl('https://evil.com/auth/callback', BASE)).toThrow();
  });

  test('throws when path uses http scheme to override the base URL origin', () => {
    expect(() => createRouteUrl('http://evil.com/auth/callback', BASE)).toThrow();
  });

  test('throws for protocol-relative-looking paths with multiple leading slashes', () => {
    expect(() => createRouteUrl('////evil.com/path', BASE)).toThrow(
      "Invalid route configuration: '////evil.com/path' contains multiple leading slashes"
    );
  });
});

describe('toSafeRedirect', () => {
  const BASE = 'http://localhost:3000';

  test('returns undefined for an external absolute URL', () => {
    expect(toSafeRedirect('http://evil.com/phishing', BASE)).toBeUndefined();
  });

  test('returns undefined for triple-slash path', () => {
    // ///evil.com → throws due to multiple leading slashes → caught → returns undefined
    expect(toSafeRedirect('///evil.com/path', BASE)).toBeUndefined();
  });

  test('returns undefined for an https absolute URL', () => {
    expect(toSafeRedirect('https://evil.com', BASE)).toBeUndefined();
  });

  test('returns the full URL for a same-origin path', () => {
    expect(toSafeRedirect('/dashboard', BASE)).toBe('http://localhost:3000/dashboard');
  });

  test('returns the full URL for a same-origin absolute URL', () => {
    expect(toSafeRedirect('http://localhost:3000/profile', BASE)).toBe(
      'http://localhost:3000/profile'
    );
  });

  test('returns undefined for a URL with a different port (different origin)', () => {
    expect(toSafeRedirect('http://localhost:4000/path', BASE)).toBeUndefined();
  });
});

describe('wrapDomainResolver', () => {
  test('returns a static string domain unchanged', () => {
    expect(wrapDomainResolver('tenant.auth0.com')).toBe('tenant.auth0.com');
  });

  test('passes storeOptions straight through to the resolver when provided', async () => {
    const ctx = { request: { headers: { host: 'explicit' } } as unknown as Request, response: {} as Response };
    const wrapped = wrapDomainResolver((opts?: StoreOptions) => Promise.resolve((opts as StoreOptions).request.headers.host as string));

    await expect(
      (wrapped as (o?: StoreOptions) => Promise<string> | string)(ctx)
    ).resolves.toBe('explicit');
  });

  test('falls back to AsyncLocalStorage request context when storeOptions is undefined', async () => {
    const ctx = { request: { headers: { host: 'from-als' } } as unknown as Request, response: {} as Response };
    const wrapped = wrapDomainResolver((opts?: StoreOptions) => (opts as StoreOptions).request.headers.host as string);

    const result = await runWithContext(ctx, () =>
      (wrapped as (o?: StoreOptions) => Promise<string> | string)(undefined)
    );

    expect(result).toBe('from-als');
  });
});
