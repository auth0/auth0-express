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

/**
 * Resolves the application base URL for the current request.
 *
 * - `string`: used as-is (static configuration).
 * - `undefined`: inferred from the request host (dynamic mode).
 * - `string[]`: the request origin is matched against the allow-list; the
 *   matching origin is returned, otherwise an error is thrown.
 *
 * @throws {InvalidConfigurationError} When the base URL cannot be resolved.
 */
export function resolveAppBaseUrl(appBaseUrl: string | string[] | undefined, req?: Request): string {
  const staticAppBaseUrl = typeof appBaseUrl === 'string' ? appBaseUrl : undefined;
  const allowedAppBaseUrls = typeof appBaseUrl === 'string' ? undefined : appBaseUrl;

  if (staticAppBaseUrl) {
    return staticAppBaseUrl;
  }

  if (!req) {
    throw new InvalidConfigurationError(
      'APP_BASE_URL is not configured as a static string, and a request context is not available.'
    );
  }

  const inferred = inferBaseUrlFromRequest(req);
  if (!inferred) {
    throw new InvalidConfigurationError(
      'APP_BASE_URL is not configured as a static string, and the request origin could not be determined from the request context.'
    );
  }

  if (!allowedAppBaseUrls) {
    return inferred;
  }

  const requestOrigin = new URL(inferred).origin;
  const isAllowed = allowedAppBaseUrls.some((allowedUrl) => {
    try {
      return new URL(allowedUrl).origin === requestOrigin;
    } catch {
      return false;
    }
  });

  if (isAllowed) {
    return requestOrigin;
  }

  throw new InvalidConfigurationError(
    'APP_BASE_URL is not configured as a static string, and the APP_BASE_URL configuration does not contain a match for the current request origin.'
  );
}
