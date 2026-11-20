import express from 'express';
import type { ErrorRequestHandler, Express, RequestHandler } from 'express';
import { createAuth0Api, requiresAuth } from '@auth0/auth0-express-api';
import type { Auth0ApiPoppyOptions } from '@auth0/auth0-express-api';
import { MemoryPoppySessionStore } from './memory-store.js';

// The public origin of the API and the agents it accepts are settings of this app: API_PUBLIC_ORIGIN and POPPY_AGENTS
// (URLs separated by commas). Both are required. The SDK reads no file for them.
function agentsFromEnv(value: string | undefined): string[] | undefined {
  const urls = (value ?? '').split(',').map((url) => url.trim());
  const agents = urls.filter((url) => url !== '');
  return agents.length === 0 ? undefined : agents;
}

// The `agents` list filters the `Poppy-Session` header only. A Session that comes from the access token of a web app
// (`source: 'token'`) names its agent in the `act` claim of the token, and the SDK does not compare that with `agents`.
// So an agent that is not on the list could still reach a route through a web app that it joined. This app refuses it.
// An agent that is linked to an Auth0 agent has the ID of that agent there (`agt_...`), and not a URL. The `agents`
// option takes URLs only, so such an agent is never on the list, and this app refuses it. To accept one, compare its ID
// with a list of your own in this function.
function listedAgentsOnly(agents: string[]): RequestHandler {
  return (req, res, next) => {
    const poppy = req.auth0.poppy;

    if (poppy?.source === 'token' && !agents.includes(poppy.agent.id)) {
      res.status(403).json({ error: 'agent_not_allowed', error_description: 'This agent is not accepted.' });
      return;
    }
    next();
  };
}

// Answers an error with a JSON body that has no detail. The default error handler of Express shows the stack trace,
// with the paths of your files, unless `NODE_ENV` is `production`, so set it, and keep a handler like this one anyway.
// Log the error: this sample does not.
const answerError: ErrorRequestHandler = (error: { status?: unknown }, _req, res, _next) => {
  const status = typeof error.status === 'number' && error.status >= 400 && error.status < 500 ? error.status : 500;
  res.status(status).json({ error: status === 500 ? 'server_error' : 'invalid_request' });
};

// `poppy` adds to the Poppy options below, or replaces them. The tests use it to pass the public origin and the test
// agent.
export function createApp(poppy?: Partial<Auth0ApiPoppyOptions>): Express {
  const app = express();

  // The `poppy` option turns on support for Personal Agents:
  // - `verifySession` checks the Poppy-Session header on every route that uses `requiresAuth()`. A route without it is
  //   not checked.
  // - `publicOrigin` is the https address that agents call. The router passes only the path of each request, so the
  //   origin of the URL that the agent signed comes from here, and `Host` is never used.
  // - `agents` lists the agents the app accepts. It is required here: without a list, anyone who can reach the API
  //   could make it fetch any public HTTPS URL, and fill the in-memory carts and Session store below with Sessions of
  //   agents of their own. It filters the header only, so `accepted` below applies it to token Sessions too.
  // - The Session store keeps a record of each Session, so that the SDK can refuse a Session that has ended. Without it,
  //   the app could not tell that a Session ended, and would keep serving its cart.
  // The domain and the audience come from AUTH0_DOMAIN and AUTH0_AUDIENCE.
  const settings: Partial<Auth0ApiPoppyOptions> = {
    verifySession: true,
    // An empty value, as in `.env.example`, is no value.
    publicOrigin: process.env.API_PUBLIC_ORIGIN || undefined,
    agents: agentsFromEnv(process.env.POPPY_AGENTS),
    sessionStore: new MemoryPoppySessionStore(),
    ...poppy,
  };
  const { publicOrigin, agents } = settings;
  if (publicOrigin === undefined) {
    throw new Error('Set API_PUBLIC_ORIGIN to the https address that agents call, such as https://shop.example.com.');
  }
  if (agents === undefined || agents.length === 0) {
    throw new Error(
      'Set POPPY_AGENTS to the client metadata URLs of the agents this API accepts, separated by commas.'
    );
  }
  const options: Auth0ApiPoppyOptions = { ...settings, publicOrigin, agents };
  app.use(createAuth0Api({ poppy: options }));
  const accepted = listedAgentsOnly(agents);

  // Carts live in memory, one for each Session. A real app keeps them in its database.
  // The key is `req.auth0.poppy.key`, which Poppy makes from the Session ID and the User ID. It is not the Session ID
  // alone, because the Sessions of two users can have the same one. The agent is not part of it, so it is a name for
  // the cart and not a secret. The User ID is the pseudonymous one of the agent, which a signed-out request has too,
  // and not the account. The key does not change when the user signs in, so the cart survives the sign-in.
  const carts = new Map<string, string[]>();

  // `requireSession` lets a request through with a Session and no access token, as from an agent whose user has not
  // signed in. Without it, such a request gets 401.
  app.get('/api/cart', requiresAuth({ poppy: { requireSession: true } }), accepted, (req, res) => {
    res.json({ items: carts.get(req.auth0.poppy!.key) ?? [] });
  });

  // Not safe to repeat: a copied Poppy-Session header works again within the `iatWindow` (60 seconds by default). A
  // real app takes an idempotency key. The body is parsed after `requiresAuth()`, so a caller that is refused costs no
  // parsing.
  app.post(
    '/api/cart/items',
    requiresAuth({ poppy: { requireSession: true } }),
    accepted,
    express.json(),
    (req, res) => {
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
    }
  );

  // This route needs a scope and an account, so a Session alone is not enough. The agent gets 401, with challenges that
  // name `orders:write`, and its user has to sign in. `req.auth0.user` then holds the claims of the access token, and
  // its `sub` is the account. `req.auth0.poppy.userId` is not the account: it is the ID that the agent gave its user.
  //
  // `requireAccount` is what keeps a guest out. A guest is an anonymous user whom the agent joined to a web app before
  // they signed in. The token of a guest is valid, and has the scopes that your tenant grants to guests, so `scopes`
  // alone would let it place an order for an `sub` that is no account. With `requireAccount` it gets the same 401 as a
  // Session alone.
  //
  // Not safe to repeat either, and a real app refuses an empty order.
  app.post(
    '/api/orders',
    requiresAuth({ scopes: 'orders:write', poppy: { requireSession: true, requireAccount: true } }),
    accepted,
    (req, res) => {
      const key = req.auth0.poppy!.key;
      const items = carts.get(key) ?? [];
      carts.delete(key);
      res.status(201).json({ sub: req.auth0.user!.sub, items });
    }
  );

  app.use(answerError);

  return app;
}
