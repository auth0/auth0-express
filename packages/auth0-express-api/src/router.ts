import { Router } from 'express';
import { ApiClient } from '@auth0/auth0-api-js';
import type { Auth0ApiOptions } from './types.js';
import { getConfig } from './config.js';
import './types/express.js';

/**
 * Integrate Auth0 API functionality into an Express router.
 * Configuration can be provided via options or environment variables.
 *
 * @param options - Configuration options (can be partial if using environment variables)
 * @returns Express Router with Auth0 API client attached
 */
export function createAuth0Api(options: Partial<Auth0ApiOptions> = {}): Router {
  const config = getConfig(options);

  const router = Router();
  const apiClient = new ApiClient({
    domain: config.domain!,
    audience: config.audience!,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    clientAssertionSigningKey: config.clientAssertionSigningKey,
    clientAssertionSigningAlg: config.clientAssertionSigningAlg,
    customFetch: config.customFetch,
  });

  // Spread rather than reassigned, so enumerable properties another middleware
  // put on `req.auth0` survive. A spread drops the non-enumerable `token`, but
  // no supported ordering has it set before this runs, since `requiresAuth()`
  // needs the client this middleware attaches.
  router.use((req, res, next) => {
    req.auth0 = { ...req.auth0, client: apiClient };
    next();
  });

  return router;
}
