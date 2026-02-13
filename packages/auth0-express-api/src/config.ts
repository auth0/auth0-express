import type { Auth0ApiOptions } from './types.js';

function stripProtocol(url: string | undefined): string | undefined {
  return url ? url.replace(/^https?:\/\//, '') : url;
}

/**
 * Merges environment variables with provided configuration options.
 * Environment variables are used as defaults and can be overridden by explicitly provided options.
 *
 * Supported environment variables:
 * - AUTH0_DOMAIN or ISSUER_BASE_URL: Auth0 domain (without https://)
 * - AUTH0_AUDIENCE or AUDIENCE: API audience
 * - AUTH0_CLIENT_ID: Auth0 application client ID (optional)
 * - AUTH0_CLIENT_SECRET: Auth0 application client secret (optional)
 * - AUTH0_CLIENT_ASSERTION_SIGNING_KEY: Private key for client assertion (optional)
 *
 * @param config - Partial configuration object
 * @returns Complete Auth0ApiOptions configuration
 * @throws Error if required fields (domain, audience) are missing
 */
export function getConfig(config: Partial<Auth0ApiOptions> = {}): Auth0ApiOptions {
  const mergedConfig = {
    domain: config.domain || process.env.AUTH0_DOMAIN || stripProtocol(process.env.ISSUER_BASE_URL),
    audience: config.audience || process.env.AUTH0_AUDIENCE || process.env.AUDIENCE,
    clientId: config.clientId || process.env.AUTH0_CLIENT_ID,
    clientSecret: config.clientSecret || process.env.AUTH0_CLIENT_SECRET,
    clientAssertionSigningKey: config.clientAssertionSigningKey || process.env.AUTH0_CLIENT_ASSERTION_SIGNING_KEY,
    clientAssertionSigningAlg: config.clientAssertionSigningAlg,
    customFetch: config.customFetch,
  } as Auth0ApiOptions;

  if (!mergedConfig.domain) {
    throw new Error("'domain' is required. Provide it via config or AUTH0_DOMAIN environment variable.");
  }

  if (!mergedConfig.audience) {
    throw new Error("'audience' is required. Provide it via config or AUTH0_AUDIENCE environment variable.");
  }

  return mergedConfig;
}
