import type { Request } from 'express';
import { InvalidConfigurationError } from './errors/index.js';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Checks if a string is a valid HTTP or HTTPS URL.
 */
export function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return HTTP_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function getFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return undefined;
  }
  const [first] = raw.split(',');
  return first?.trim() || undefined;
}

/**
 * Infers the application base URL from the incoming request.
 * Prefers `x-forwarded-host`/`x-forwarded-proto`, falling back to the `host`
 * header and `req.protocol`. Returns null when a valid origin cannot be built.
 */
export function inferBaseUrlFromRequest(req: Request): string | null {
  const forwardedProto = getFirstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = getFirstHeaderValue(req.headers['x-forwarded-host']);
  const host = forwardedHost || getFirstHeaderValue(req.headers['host']);
  const proto = forwardedProto || req.protocol;

  if (!host || !proto) {
    return null;
  }

  const candidate = `${proto}://${host}`;
  return isUrl(candidate) ? candidate : null;
}
