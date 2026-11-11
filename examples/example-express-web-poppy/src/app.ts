import express from 'express';
import type { Express } from 'express';
import { createAuth0, requiresAuth } from '@auth0/auth0-express';
import type { Auth0Options, PoppyAgentContext, PoppyVisitor } from '@auth0/auth0-express';

// One fixed sentence for each kind of visitor. The `Record` needs a key for every kind, so the build of this app stops
// when a later version of the SDK adds a kind that is not described here. This app does not turn on anonymous sessions,
// so it never sees `anonymous`.
const SENTENCES: Record<PoppyVisitor['kind'], string> = {
  none: 'Nobody has joined or signed in from this browser.',
  anonymous: 'This browser has an anonymous session.',
  guest: 'An agent is browsing for a user who has not signed in.',
  user: 'A signed-in user is browsing.',
};

// The key of the cart of a visitor, or `undefined` when the visitor has no cart.
// - An agent's browser uses `poppy.key`, as a guest and after its user signs in. The key is the same in both states, so
//   the cart survives the sign-in. It is not the user, because a guest has none. It is not the id of the Poppy Session
//   alone either, because two agents can pick the same id.
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

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title></head><body>${body}</body></html>`;

// Escapes a value for HTML text. The session section shows values from tokens (`sub`, the URL of the agent, and so on),
// and a person or an agent chooses some of them, so no such value goes into the page without this.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

type Row = [label: string, value: string | undefined];

// The rows for an agent's browser. A guest has a `poppy`, and so has a user whose session an agent joined.
const agentRows = (poppy: PoppyAgentContext): Row[] => [
  ['Poppy Session state', poppy.state],
  ['Poppy Session ID', poppy.sessionId],
  ['Poppy user ID', poppy.userId],
  ['Agent', poppy.agent.cimdUrl],
  ['Cart key', poppy.key],
];

// What the session section shows for each kind of visitor.
function sessionRows(visitor: PoppyVisitor): Row[] {
  switch (visitor.kind) {
    case 'none':
    case 'anonymous':
      return [];
    case 'guest':
      return agentRows(visitor.poppy);
    case 'user':
      return [
        ['Subject (sub)', visitor.user.sub],
        ['Name', visitor.user.name],
        ['Email', visitor.user.email],
        ...(visitor.poppy ? agentRows(visitor.poppy) : []),
      ];
    default: {
      // This does not compile when a later version of the SDK adds a kind that the switch does not handle.
      const unhandled: never = visitor;
      return unhandled;
    }
  }
}

// The buttons of the page. A visitor with a session can log out. Nobody who has a session can log in, and neither can a
// guest: a guest cannot sign in on the website, because the person the agent acts for signs in through the agent. The
// login route could also bring back the same guest, so the page does not offer it. The login button goes to the normal
// login route, without `iss` or `target_link_uri`, so it is the login of a person and not the join of an agent.
function buttons(visitor: PoppyVisitor): string {
  const login =
    visitor.kind === 'none' || visitor.kind === 'anonymous' ? '<a class="button" href="/auth/login">Log in</a>' : '';
  const logout = visitor.kind === 'none' ? '' : '<a class="button" href="/auth/logout">Log out</a>';

  return `<p>${login} ${logout}</p>`;
}

// The section with the information of the current session.
function sessionSection(visitor: PoppyVisitor): string {
  const rows: Row[] = [['Visitor', visitor.kind], ...sessionRows(visitor)];
  const shown = rows.filter((row): row is [string, string] => row[1] !== undefined && row[1] !== '');
  const list = shown.map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('');

  return `<section id="session"><h2>Current session</h2><dl>${list}</dl></section>`;
}

// `options` replace what the SDK reads from AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SESSION_SECRET
// and APP_BASE_URL. The tests use them to run the app with no tenant and with no auth0-poppy.json.
export function createApp(options: Partial<Auth0Options> = {}): Express {
  const app = express();

  // The cart route reads a JSON body.
  app.use(express.json());

  // The `poppy` option turns on support for Personal Agents. The router then:
  // - serves /.well-known/poppy.json and /.well-known/oauth-protected-resource from auth0-poppy.json. It reads the file
  //   once, at startup, from the working directory. Agents look for both documents at the root of the site.
  // - checks `iss` on the login route. After the login it sends the browser to `target_link_uri` only when that is a
  //   page of this site, and it never sends `iss` or `target_link_uri` on to Auth0.
  // - turns the join of an agent's browser into a guest or a signed-in user, and tells a route who drives the browser
  //   with `getVisitor()`.
  app.use(createAuth0({ poppy: true, ...options }));

  // Carts live in memory, one for each key. A real app keeps them in its database.
  const carts = new Map<string, string[]>();

  app.get('/', async (req, res) => {
    const visitor = await req.auth0.client.poppy.getVisitor();
    const key = cartKey(visitor);
    const count = key === undefined ? 0 : (carts.get(key)?.length ?? 0);

    // The sentence is fixed text. The values in the session section come from tokens, and `escapeHtml` escapes each one.
    res.send(
      page(
        `<h1>Shop</h1><p>${SENTENCES[visitor.kind]}</p><p>Items in the cart: ${count}.</p>${buttons(visitor)}` +
          sessionSection(visitor)
      )
    );
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

  // `requiresAuth()` looks for a user, and a guest is not a user, so it answers a guest with 403. It does not send a guest
  // to the login page, because a guest cannot sign in there and the login route could bring back the same guest, so the
  // redirect would repeat without end. The exception is a browser that also holds a person's own login (see the README
  // of this example).
  app.get('/orders', requiresAuth(), (_req, res) => {
    res.send(page('<p>Your orders are shown here, because you are signed in.</p>'));
  });

  return app;
}
