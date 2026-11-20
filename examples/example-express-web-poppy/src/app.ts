import express from 'express';
import type { Express } from 'express';
import { createAuth0, requiresAuth } from '@auth0/auth0-express';
import type { Auth0Options, PoppyVisitor } from '@auth0/auth0-express';
import { homePage, ordersPage } from './views.js';

// This file is the SDK part of the example. There are four steps:
//   1. `createAuth0({ poppy: true })` turns on support for Personal Agents.
//   2. `getVisitor()` tells a route who is browsing: nobody, a guest, or a signed-in user.
//   3. `cartKey()` uses `poppy.key` as the key of the cart of an agent's browser.
//   4. `requiresAuth()` keeps a page for signed-in users.
// The page itself is in `views.ts`.

// `options` replace what the SDK reads from AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SESSION_SECRET
// and APP_BASE_URL. The tests use them to run the app with no tenant and with no poppy.json.
export function createApp(options: Partial<Auth0Options> = {}): Express {
  const app = express();

  // Every answer of this app, except the two discovery files, depends on the cookies of the visitor. Without this, a shared
  // cache such as a CDN could keep the answer for one visitor and give it to another. The router sets its own
  // `cache-control: public, max-age=300` on the two discovery files, which replaces this header there.
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // The cart route reads a JSON body.
  app.use(express.json());

  // Step 1. The `poppy` option turns on support for Personal Agents. The router then:
  // - serves /.well-known/poppy.json and /.well-known/oauth-protected-resource from poppy.json, the file that
  //   `auth0 poppy config` writes. It reads the file once, at startup, from the working directory. Agents look for both
  //   documents at the root of the site.
  // - reads `iss` on the login route. After the login it sends the browser to `target_link_uri` only when `iss` is the
  //   issuer and the target is a page of this site, and it never sends `iss` or `target_link_uri` on to Auth0. A request
  //   with an `iss` that is not the issuer is refused with a 400, and a request with no `iss` is a normal login.
  // - turns the join of an agent's browser into a guest or a signed-in user.
  app.use(createAuth0({ poppy: true, ...options }));

  // Carts live in memory, one for each key. A real app keeps them in its database.
  const carts = new Map<string, string[]>();

  app.get('/', async (req, res) => {
    // Step 2. Who is browsing?
    const visitor = await req.auth0.client.poppy.getVisitor();
    // Step 3. Which cart is theirs?
    const key = cartKey(visitor);

    // The page escapes every value that comes from a token or from a visitor.
    res.send(homePage(visitor, key === undefined ? undefined : (carts.get(key) ?? [])));
  });

  app.get('/api/visitor', async (req, res) => {
    const visitor = await req.auth0.client.poppy.getVisitor();
    // `poppy` is there for a guest, and for a user whose session an agent joined. Its `state` says whether the user of
    // the agent has signed in.
    const poppy = visitor.kind === 'guest' || visitor.kind === 'user' ? visitor.poppy : undefined;

    res.json(poppy ? { kind: visitor.kind, state: poppy.state } : { kind: visitor.kind });
  });

  app.get('/api/cart', async (req, res) => {
    const key = cartKey(await req.auth0.client.poppy.getVisitor());
    if (key === undefined) {
      res.status(401).json({ error: 'no_cart' });
      return;
    }

    res.json({ items: carts.get(key) ?? [] });
  });

  app.post('/api/cart/items', async (req, res) => {
    const key = cartKey(await req.auth0.client.poppy.getVisitor());
    if (key === undefined) {
      res.status(401).json({ error: 'no_cart' });
      return;
    }

    const sku: unknown = req.body?.sku;
    // A real app also checks the sku against its catalog.
    if (typeof sku !== 'string' || sku === '') {
      res.status(400).json({ error: 'invalid_sku' });
      return;
    }

    const items = [...(carts.get(key) ?? []), sku];
    carts.set(key, items);
    res.status(201).json({ items });
  });

  // Step 4. `requiresAuth()` looks for a user, and a guest is not a user, so it answers a guest with 403. It does not
  // send a guest to the login page, because a login cannot sign a guest in as a user. The SDK never writes a guest and
  // a person's session together: a guest join ends the session of a person, and while a guest is there, a person's
  // login is refused with a 403 (see the README of this example).
  app.get('/orders', requiresAuth(), (_req, res) => {
    res.send(ordersPage());
  });

  return app;
}

// The key of the cart of a visitor, or `undefined` when the visitor has no cart.
// - An agent's browser uses `poppy.key`, as a guest and after its user signs in. The key comes from `act.poppy_sid`
//   and `act.poppy_user_id`, so it is the same in both states while the sign-in join has the same two, and then the cart
//   can survive the sign-in. When one of them differs, the key is another one and the cart of the guest is not found:
//   keep under it only what you can afford to lose. It is not the user, because a guest has none. It is not the id of
//   the Poppy Session alone either, because the Sessions of two users can have the same id. The agent is not part of
//   the key, so treat it as the name of a cart and not as a secret.
// - A person who logged in on their own has no `poppy`, so the cart is under the account (`sub`).
// - Nobody, and an anonymous session, have no cart.
function cartKey(visitor: PoppyVisitor): string | undefined {
  switch (visitor.kind) {
    case 'guest':
      return visitor.poppy.key;
    case 'user':
      return visitor.poppy?.key ?? visitor.user.sub;
    case 'none':
    case 'anonymous':
      return undefined;
    default: {
      // This does not compile when a later version of the SDK adds a kind that the switch does not handle.
      const unhandled: never = visitor;
      return unhandled;
    }
  }
}
