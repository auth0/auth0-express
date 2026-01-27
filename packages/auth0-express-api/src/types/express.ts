import type { ApiClient } from '@auth0/auth0-api-js';
import type { Token } from '../types.js';

declare global {
  namespace Express {
    interface Request {
      auth0: {
        user?: Token;
        token?: string;
        client?: ApiClient;
      };
    }
  }
}

export {};
