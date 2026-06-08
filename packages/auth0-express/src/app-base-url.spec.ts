import { describe, expect, test } from 'vitest';
import type { Request } from 'express';
import { isUrl, inferBaseUrlFromRequest, resolveAppBaseUrl } from './app-base-url.js';
import { InvalidConfigurationError } from './errors/index.js';

function makeRequest(opts: { headers?: Record<string, string>; protocol?: string }): Request {
  return {
    headers: opts.headers ?? {},
    protocol: opts.protocol ?? 'http',
  } as unknown as Request;
}

describe('isUrl', () => {
  test('returns true for http and https URLs', () => {
    expect(isUrl('http://example.com')).toBe(true);
    expect(isUrl('http://localhost:3000')).toBe(true);
    expect(isUrl('https://myapp.vercel.app')).toBe(true);
  });

  test('returns false for non-http(s) URLs', () => {
    expect(isUrl('ftp://example.com')).toBe(false);
    expect(isUrl('file://example.com')).toBe(false);
  });

  test('returns false for non-URL strings', () => {
    expect(isUrl('not-a-url')).toBe(false);
    expect(isUrl('')).toBe(false);
  });
});

describe('inferBaseUrlFromRequest', () => {
  test('uses host header and request protocol', () => {
    const req = makeRequest({ headers: { host: 'example.com' }, protocol: 'https' });
    expect(inferBaseUrlFromRequest(req)).toBe('https://example.com');
  });

  test('prefers x-forwarded-host and x-forwarded-proto over host/protocol', () => {
    const req = makeRequest({
      headers: {
        host: 'internal.local',
        'x-forwarded-host': 'preview.example.com',
        'x-forwarded-proto': 'https',
      },
      protocol: 'http',
    });
    expect(inferBaseUrlFromRequest(req)).toBe('https://preview.example.com');
  });

  test('takes the first value from comma-separated forwarded headers', () => {
    const req = makeRequest({
      headers: {
        'x-forwarded-host': 'preview.example.com, internal.local',
        'x-forwarded-proto': 'https, http',
      },
    });
    expect(inferBaseUrlFromRequest(req)).toBe('https://preview.example.com');
  });

  test('returns null when host cannot be determined', () => {
    const req = makeRequest({ headers: {}, protocol: 'https' });
    expect(inferBaseUrlFromRequest(req)).toBeNull();
  });
});

describe('resolveAppBaseUrl', () => {
  test('returns a static string base URL as-is', () => {
    expect(resolveAppBaseUrl('https://app.example.com')).toBe('https://app.example.com');
  });

  test('infers from request when appBaseUrl is undefined', () => {
    const req = makeRequest({ headers: { host: 'preview.example.com' }, protocol: 'https' });
    expect(resolveAppBaseUrl(undefined, req)).toBe('https://preview.example.com');
  });

  test('throws when undefined and no request is available', () => {
    expect(() => resolveAppBaseUrl(undefined)).toThrowError(InvalidConfigurationError);
  });

  test('throws when undefined and the request origin cannot be determined', () => {
    const req = makeRequest({ headers: {} });
    expect(() => resolveAppBaseUrl(undefined, req)).toThrowError(InvalidConfigurationError);
  });

  test('matches the request origin against an allow-list array', () => {
    const req = makeRequest({ headers: { host: 'app2.example.com' }, protocol: 'https' });
    expect(
      resolveAppBaseUrl(['https://app1.example.com', 'https://app2.example.com'], req)
    ).toBe('https://app2.example.com');
  });

  test('matches allow-list entries that differ only by port', () => {
    const req = makeRequest({ headers: { host: 'localhost:3001' }, protocol: 'http' });
    expect(
      resolveAppBaseUrl(['http://localhost:3000', 'http://localhost:3001'], req)
    ).toBe('http://localhost:3001');
  });

  test('throws when the request origin is not in the allow-list', () => {
    const req = makeRequest({ headers: { host: 'unknown.example.com' }, protocol: 'https' });
    expect(() =>
      resolveAppBaseUrl(['https://app1.example.com', 'https://app2.example.com'], req)
    ).toThrowError(InvalidConfigurationError);
  });

  test('throws when an allow-list array is provided but no request is available', () => {
    expect(() => resolveAppBaseUrl(['https://app1.example.com'])).toThrowError(
      InvalidConfigurationError
    );
  });

  test('skips invalid allow-list entries and still matches a valid one', () => {
    const req = makeRequest({ headers: { host: 'app1.example.com' }, protocol: 'https' });
    expect(resolveAppBaseUrl(['not-a-url', 'https://app1.example.com'], req)).toBe(
      'https://app1.example.com'
    );
  });
});
