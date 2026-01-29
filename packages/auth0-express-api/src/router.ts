import { Router } from 'express';
import { ApiClient } from '@auth0/auth0-api-js';
import type { Auth0ApiOptions } from './types.js';
import './types/express.js';

/**
 * Integrate Auth0 API functionality into an Express router
 * @param options 
 * @returns 
 */
export function createAuth0Api(options: Auth0ApiOptions): Router {
  if (!options.audience) {
    throw new Error('In order to use the Auth0 Express API plugin, you must provide an audience.');
  }

  const router = Router();
  const apiClient = new ApiClient({
    domain: options.domain,
    audience: options.audience,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    clientAssertionSigningKey: options.clientAssertionSigningKey,
    clientAssertionSigningAlg: options.clientAssertionSigningAlg,
    customFetch: options.customFetch,
  });

  // Attach client and requireAuth to router locals
  router.use((req, res, next) => {
    req.auth0 = req.auth0 || {};
    req.auth0.client = apiClient;
    next();
  });

  return router;
}
