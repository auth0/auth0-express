import { describe, expect, test } from 'vitest';
import { isUrl } from './app-base-url.js';

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
