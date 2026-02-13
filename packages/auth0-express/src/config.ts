import { MissingRequiredArgumentError } from '@auth0/auth0-server-js';
import type { Auth0Options } from './types.js';

function stripProtocol(url: string | undefined): string | undefined {
  return url ? url.replace(/^https?:\/\//, '') : url;
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
    appBaseUrl: process.env.APP_BASE_URL || process.env.BASE_URL,
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

  if (!mergedConfig.appBaseUrl) {
    throw new MissingRequiredArgumentError('appBaseUrl');
  }

  if (!mergedConfig.sessionSecret) {
    throw new MissingRequiredArgumentError('sessionSecret');
  }

  return mergedConfig;
}
