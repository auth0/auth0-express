import { MissingRequiredArgumentError } from '@auth0/auth0-server-js';
import type { Auth0Options } from './types.js';
import { isUrl } from './app-base-url.js';
import { InvalidConfigurationError } from './errors/index.js';

function stripProtocol(url: string | undefined): string | undefined {
  return url ? url.replace(/^https?:\/\//, '') : url;
}

function parseAppBaseUrlEnv(value: string | undefined): string | string[] | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes(',')) {
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return entries.length === 1 ? entries[0] : entries;
  }
  return value;
}

function validateAppBaseUrl(appBaseUrl: string | string[] | undefined): void {
  if (appBaseUrl === undefined) {
    return; // dynamic mode
  }

  if (Array.isArray(appBaseUrl)) {
    if (appBaseUrl.length === 0) {
      throw new InvalidConfigurationError('APP_BASE_URL array configuration cannot be empty.');
    }
    const invalid = appBaseUrl.filter((url) => !isUrl(url));
    if (invalid.length > 0) {
      throw new InvalidConfigurationError(
        `APP_BASE_URL array contains invalid URLs: ${invalid.join(', ')}`
      );
    }
    return;
  }

  if (!isUrl(appBaseUrl)) {
    throw new InvalidConfigurationError(`APP_BASE_URL must be a valid http(s) URL: ${appBaseUrl}`);
  }
}

function enforceSecureCookies(config: Auth0Options): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDynamic = typeof config.appBaseUrl !== 'string';

  if (!isProduction || !isDynamic) {
    return;
  }

  const explicitSecure = config.sessionConfiguration?.cookie?.secure;
  if (explicitSecure === false) {
    throw new InvalidConfigurationError(
      'Secure cookies are required when relying on dynamic base URLs in production. ' +
        'Remove the explicit `sessionConfiguration.cookie.secure = false` or set a static APP_BASE_URL.'
    );
  }

  config.sessionConfiguration = {
    ...config.sessionConfiguration,
    cookie: {
      ...config.sessionConfiguration?.cookie,
      secure: true,
    },
  };
}

/**
 * Merges environment variables with provided configuration options.
 * Environment variables are used as defaults and can be overridden by explicitly provided options.
 *
 * Supported environment variables:
 * - AUTH0_DOMAIN or ISSUER_BASE_URL
 * - AUTH0_CLIENT_ID or CLIENT_ID: Auth0 application client ID
 * - AUTH0_CLIENT_SECRET or CLIENT_SECRET: Auth0 application client secret
 * - APP_BASE_URL or BASE_URL: Application base URL
 * - AUTH0_SESSION_SECRET or SECRET: Session secret for cookie signing
 * - AUTH0_AUDIENCE: Optional API audience
 */
export function getConfig(config: Partial<Auth0Options> = {}): Auth0Options {
  const mergedConfig = {
    domain: process.env.AUTH0_DOMAIN || stripProtocol(process.env.ISSUER_BASE_URL),
    clientId: process.env.AUTH0_CLIENT_ID || process.env.CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET || process.env.CLIENT_SECRET,
    appBaseUrl: parseAppBaseUrlEnv(process.env.APP_BASE_URL || process.env.BASE_URL),
    sessionSecret: process.env.AUTH0_SESSION_SECRET || process.env.SECRET,
    audience: process.env.AUTH0_AUDIENCE,
    ...config,
  } as Auth0Options;

  if (!mergedConfig.domain) {
    throw new MissingRequiredArgumentError('domain');
  }

  if (!mergedConfig.clientId) {
    throw new MissingRequiredArgumentError('clientId');
  }

  validateAppBaseUrl(mergedConfig.appBaseUrl);

  if (!mergedConfig.sessionSecret) {
    throw new MissingRequiredArgumentError('sessionSecret');
  }

  enforceSecureCookies(mergedConfig);

  return mergedConfig;
}
