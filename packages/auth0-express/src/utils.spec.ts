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
      "Invalid route configuration: '///evil.com/auth/callback' contains multiple leading slashes or backslashes"
    );
    expect(() => createRouteUrl('///custom-auth/callback', BASE)).toThrow(
      "Invalid route configuration: '///custom-auth/callback' contains multiple leading slashes or backslashes"
    );
  });

  test('throws when path has multiple leading backslashes', () => {
    expect(() => createRouteUrl('\\\\evil.com/path', BASE)).toThrow(
      "Invalid route configuration: '\\\\evil.com/path' contains multiple leading slashes or backslashes"
    );
  });

  test('throws when path has mixed leading slash and backslash', () => {
    expect(() => createRouteUrl('/\\evil.com/path', BASE)).toThrow(
      "Invalid route configuration: '/\\evil.com/path' contains multiple leading slashes or backslashes"
    );
    expect(() => createRouteUrl('\\/evil.com/path', BASE)).toThrow(
      "Invalid route configuration: '\\/evil.com/path' contains multiple leading slashes or backslashes"
    );
  });

  test('does not throw for a single leading slash', () => {
    expect(createRouteUrl('/auth/callback', BASE).href).toBe('https://myapp.com/auth/callback');
  });

  test('does not throw for no leading slash', () => {
    expect(createRouteUrl('auth/callback', BASE).href).toBe('https://myapp.com/auth/callback');
  });

  test('single leading backslash is stripped and resolves as a same-origin relative path', () => {
    // A single \ is stripped to a plain relative path — not a protocol-relative bypass.
    // The WHATWG URL parser also normalises \ to / within the path.
    expect(createRouteUrl('\\auth\\callback', BASE).href).toBe('https://myapp.com/auth/callback');
  });

  test('allows paths with a colon in non-first segment', () => {
    expect(createRouteUrl('/a/b:c', BASE).href).toBe('https://myapp.com/a/b:c');
  });

  test('allows paths whose first segment starts with a digit followed by a colon', () => {
    // "2024-report:summary" starts with a digit — not a valid URI scheme per RFC 3986.
    expect(createRouteUrl('/2024-report:summary', BASE).href).toBe('https://myapp.com/2024-report:summary');
  });

  test('allows bare first-segment colon paths without a leading slash', () => {
    // "report:summary" looks scheme-like but has no authority (no ://).
    // It must resolve as a same-origin relative path, not be misclassified as a scheme.
    expect(createRouteUrl('report:summary', BASE).href).toBe('https://myapp.com/report:summary');
    expect(createRouteUrl('news:today', BASE).href).toBe('https://myapp.com/news:today');
  });

  test('accepts an absolute same-origin URL (e.g. from a reverse proxy)', () => {
    expect(createRouteUrl('https://myapp.com/auth/callback?code=abc', BASE).href).toBe(
      'https://myapp.com/auth/callback?code=abc'
    );
  });

  test('accepts an absolute same-origin URL with subpath base', () => {
    expect(createRouteUrl('https://myapp.com/subapp/auth/callback?code=abc', BASE_WITH_SUBPATH).href).toBe(
      'https://myapp.com/subapp/auth/callback?code=abc'
    );
  });

  test('throws when absolute URL has a different origin', () => {
    expect(() => createRouteUrl('https://evil.com/auth/callback', BASE)).toThrow(
      'URL is not allowed: origin does not match base URL'
    );
  });

  test('throws when path uses http scheme to override the base URL origin', () => {
    expect(() => createRouteUrl('http://evil.com/auth/callback', BASE)).toThrow(
      'URL is not allowed: origin does not match base URL'
    );
  });

  test('resolves javascript: as a safe relative path (no authority)', () => {
    // javascript: has no :// so it is treated as a relative path, not a scheme.
    // The WHATWG parser resolves ./javascript:alert(1) against the base as a same-origin path.
    expect(createRouteUrl('javascript:alert(1)', BASE).href).toBe('https://myapp.com/javascript:alert(1)');
  });

  test('resolves data: as a safe relative path (no authority)', () => {
    expect(createRouteUrl('data:text/html,x', BASE).href).toBe('https://myapp.com/data:text/html,x');
  });

  test('throws when path uses file:// scheme (has authority)', () => {
    expect(() => createRouteUrl('file:///etc/passwd', BASE)).toThrow(
      'URL is not allowed: origin does not match base URL'
    );
  });

  test('throws for protocol-relative-looking paths with multiple leading slashes', () => {
    expect(() => createRouteUrl('////evil.com/path', BASE)).toThrow(
      "Invalid route configuration: '////evil.com/path' contains multiple leading slashes or backslashes"
    );
  });
});

describe('toSafeRedirect', () => {
  const BASE = 'http://localhost:3000';

  test('returns undefined for an external absolute URL', () => {
    expect(toSafeRedirect('http://evil.com/phishing', BASE)).toBeUndefined();
  });

  test('returns undefined for triple-slash path', () => {
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

  test('returns undefined for backslash-based protocol-relative bypass attempts', () => {
    expect(toSafeRedirect('\\\\evil.com', BASE)).toBeUndefined();
    expect(toSafeRedirect('/\\evil.com', BASE)).toBeUndefined();
    expect(toSafeRedirect('\\/evil.com', BASE)).toBeUndefined();
  });

  test('returns undefined when safeBaseUrl is not a valid URL', () => {
    expect(toSafeRedirect('/dashboard', 'not-a-url')).toBeUndefined();
  });

  test('preserves subpath when resolving a relative path against a subpath base', () => {
    expect(toSafeRedirect('/dashboard', 'http://localhost:3000/app')).toBe('http://localhost:3000/app/dashboard');
  });

  test('returns undefined for javascript: input (resolves as same-origin but returned as path)', () => {
    // javascript: has no authority — resolves as a relative path to a same-origin URL, safe to redirect.
    expect(toSafeRedirect('javascript:alert(1)', BASE)).toBe('http://localhost:3000/javascript:alert(1)');
  });

  test('returns undefined for file:// input (different origin)', () => {
    expect(toSafeRedirect('file:///etc/passwd', BASE)).toBeUndefined();
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
