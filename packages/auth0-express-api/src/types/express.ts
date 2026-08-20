import type { ApiClient } from '@auth0/auth0-api-js';
import type { Token } from '../types.js';

declare global {
  namespace Express {
    interface Request {
      auth0: {
        /**
         * The verified claims of the access token.
         * Set by `requiresAuth()` once verification succeeds.
         */
        user?: Token;
        /**
         * The raw access token string, exactly as it arrived in the
         * `Authorization` header.
         *
         * Set by `requiresAuth()` at the same point as {@link user}, so it is
         * only ever present on a request whose token this API has verified.
         * Pass it to {@link client} as the subject token when calling a
         * downstream API on behalf of the caller.
         *
         * Non-enumerable, so `JSON.stringify()`, object spreads and
         * `console.log()` leave it out. Read it directly, and keep it out of
         * logs, error reports and responses.
         */
        token?: string;
        /**
         * The `ApiClient` instance built from the router configuration.
         *
         * Attached by the router on every request, before `requiresAuth()` runs,
         * so it is available even on unauthenticated requests. Use it to call
         * Auth0 as a client, for example to exchange the caller's token for one
         * targeting a downstream API.
         *
         * Declared as required, since every request the router handles has it.
         * That holds only once the router has run: on a request that never
         * passed through `createAuth0Api()`, because it was never mounted, this
         * is `undefined` despite the type, and `requiresAuth()` throws to say so.
         *
         * @example
         * ```ts
         * router.get('/orders', requiresAuth(), async (req, res) => {
         *   const { accessToken } = await req.auth0.client.getTokenOnBehalfOf(req.auth0.token!, {
         *     audience: 'https://orders.example.com',
         *   });
         *   res.json(await fetchOrders(accessToken));
         * });
         * ```
         */
        client: ApiClient;
      };
    }
  }
}

export {};
