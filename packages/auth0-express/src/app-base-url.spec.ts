import { describe, expect, test } from 'vitest';
import type { Request } from 'express';
import { isUrl, inferBaseUrlFromRequest } from './app-base-url.js';

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
