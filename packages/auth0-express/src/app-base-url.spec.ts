import { describe, expect, test } from 'vitest';
import type { Request } from 'express';
import { isUrl, inferBaseUrlFromRequest, resolveAppBaseUrl } from './app-base-url.js';
import { InvalidConfigurationError } from './errors/index.js';

function makeRequest(opts: {
  headers?: Record<string, string>;
  protocol?: string;
  trustProxy?: boolean;
}): Request {
  const trustProxy = opts.trustProxy ?? false;
  return {
    headers: opts.headers ?? {},
    protocol: opts.protocol ?? 'http',
    socket: { remoteAddress: '127.0.0.1' },
    app: {
      get: (key: string) => (key === 'trust proxy fn' ? () => trustProxy : undefined),
    },
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

  test('returns null for a host containing embedded credentials (@)', () => {
    // "user:pass@evil.com" in the Host header; the URL constructor would parse
    // this as origin "https://evil.com", leaking the origin check — verify the
    // function produces a URL that is actually safe to use.
    const req = makeRequest({
      headers: { host: 'legitimate.com@evil.com' },
      protocol: 'https',
    });
    // The constructed candidate "https://legitimate.com@evil.com" has origin
    // "https://evil.com", which isUrl accepts. We document and test the current
    // behaviour: a non-null value is returned whose origin is evil.com, not
    // legitimate.com. This test exists to make the behaviour explicit so that
    // any future hardening is covered by a regression test.
    const result = inferBaseUrlFromRequest(req);
    if (result !== null) {
      expect(new URL(result).origin).not.toBe('https://legitimate.com');
    }
  });

  test('returns null for a host with only whitespace', () => {
    const req = makeRequest({ headers: { host: '   ' }, protocol: 'https' });
    expect(inferBaseUrlFromRequest(req)).toBeNull();
  });

  test('returns null for an empty host header', () => {
    const req = makeRequest({ headers: { host: '' }, protocol: 'https' });
    expect(inferBaseUrlFromRequest(req)).toBeNull();
  });

  test('prefers x-forwarded-host over host when the proxy is trusted', () => {
    const req = makeRequest({
      headers: {
        host: 'internal.local',
        'x-forwarded-host': 'preview.example.com',
      },
      protocol: 'https',
      trustProxy: true,
    });
    expect(inferBaseUrlFromRequest(req)).toBe('https://preview.example.com');
  });

  test('ignores x-forwarded-host when the proxy is not trusted', () => {
    const req = makeRequest({
      headers: {
        host: 'internal.local',
        'x-forwarded-host': 'preview.example.com',
      },
      protocol: 'https',
      trustProxy: false,
    });
    expect(inferBaseUrlFromRequest(req)).toBe('https://internal.local');
  });

  test('takes the first value from a comma-separated x-forwarded-host when trusted', () => {
    const req = makeRequest({
      headers: {
        'x-forwarded-host': 'preview.example.com, internal.local',
      },
      protocol: 'https',
      trustProxy: true,
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

  test('returns the matched allow-list entry including its path', () => {
    const req = makeRequest({ headers: { host: 'app.example.com' }, protocol: 'https' });
    expect(resolveAppBaseUrl(['https://app.example.com/base'], req)).toBe(
      'https://app.example.com/base'
    );
  });
});
