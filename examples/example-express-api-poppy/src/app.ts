import express from 'express';
import type { Express } from 'express';
import { createAuth0Api, requiresAuth } from '@auth0/auth0-express-api';
import type { Auth0ApiPoppyOptions } from '@auth0/auth0-express-api';
import { MemoryPoppySessionStore } from './memory-store.js';

// The public origin of the API and the agents it accepts are settings of this app: API_PUBLIC_ORIGIN and POPPY_AGENTS
// (URLs separated by commas, optional). The SDK reads no file for them.
function agentsFromEnv(value: string | undefined): string[] | undefined {
  const urls = (value ?? '').split(',').map((url) => url.trim());
  const agents = urls.filter((url) => url !== '');
  return agents.length === 0 ? undefined : agents;
}

// `poppy` adds to the Poppy options below, or replaces them. The tests use it to pass the public origin and the test
// agent.
export function createApp(poppy?: Auth0ApiPoppyOptions): Express {
  const app = express();

  app.use(express.json());

  // The `poppy` option turns on support for Personal Agents:
  // - `verifySession` checks the Poppy-Session header on every route that uses `requiresAuth()`. A route without it is
  //   not checked.
  // - `publicOrigin` is the https address that agents call. The router passes only the path of each request, so the
  //   origin of the URL that the agent signed comes from here, and `Host` is never used.
  // - `agents` lists the agents the app accepts. Without a list, any public HTTPS agent URL is accepted.
  // - The Session store keeps a record of each Session, so that the SDK can refuse a Session whose user changed, or
  //   that has ended. Without it, the carts below, which are keyed by `poppy.key`, could be shared by two users.
  // The domain and the audience come from AUTH0_DOMAIN and AUTH0_AUDIENCE.
  const options: Auth0ApiPoppyOptions = {
    verifySession: true,
    publicOrigin: process.env.API_PUBLIC_ORIGIN,
    agents: agentsFromEnv(process.env.POPPY_AGENTS),
    sessionStore: new MemoryPoppySessionStore(),
    ...poppy,
  };
  if (options.publicOrigin === undefined) {
    throw new Error('Set API_PUBLIC_ORIGIN to the https address that agents call, such as https://shop.example.com.');
  }
  app.use(createAuth0Api({ poppy: options }));

  // Carts live in memory, one for each Session. A real app keeps them in its database.
  // The key is `req.auth0.poppy.key`. It is not the Session ID alone, because two agents can pick the same one. It is
  // not the user either, because a signed-out request has none. It does not change when the user signs in, so the cart
  // survives the sign-in.
  const carts = new Map<string, string[]>();

  // `requireSession` lets a request through with a Session and no access token, as from an agent whose user has not
  // signed in. Without it, such a request gets 401.
  app.get('/api/cart', requiresAuth({ poppy: { requireSession: true } }), (req, res) => {
    res.json({ items: carts.get(req.auth0.poppy!.key) ?? [] });
  });

  // Not safe to repeat: a copied Poppy-Session header works again within the `iatWindow` (60 seconds by default). A
  // real app takes an idempotency key.
  app.post('/api/cart/items', requiresAuth({ poppy: { requireSession: true } }), (req, res) => {
    const sku: unknown = req.body?.sku;
    // A real app also checks the sku against its catalog.
    if (typeof sku !== 'string' || sku === '') {
      res.status(400).json({ error: 'invalid_request', error_description: 'Send a JSON body with a "sku".' });
      return;
    }

    const key = req.auth0.poppy!.key;
    const items = [...(carts.get(key) ?? []), sku];
    carts.set(key, items);
    res.status(201).json({ items });
  });

  // This route needs a scope, so a Session alone is not enough. The agent gets 401, with challenges that name
  // `orders:write`, and its user has to sign in. `req.auth0.user` then holds the claims of the access token, and its
  // `sub` is the account. `req.auth0.poppy.userId` is not the account: it is the ID that the agent gave its user.
  // Not safe to repeat either, and a real app refuses an empty order.
  app.post('/api/orders', requiresAuth({ scopes: 'orders:write', poppy: { requireSession: true } }), (req, res) => {
    const key = req.auth0.poppy!.key;
    const items = carts.get(key) ?? [];
    carts.delete(key);
    res.status(201).json({ sub: req.auth0.user!.sub, items });
  });

  return app;
}
