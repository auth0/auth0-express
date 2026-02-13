import type { ServerClient } from '@auth0/auth0-server-js';
import type { StoreOptions } from '../types.js';

declare global {
  namespace Express {
    interface Request {
      auth0: {
        client: ServerClient<StoreOptions>;
      };
    }
  }
}

export {};
