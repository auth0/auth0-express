// The HTML of the shop. Nothing in this file calls the SDK: it only turns what `app.ts` found out into a page.
// Open `app.ts` first to see how the SDK is used.
import type { PoppyAgentContext, PoppyVisitor } from '@auth0/auth0-express';

// What the shop sells. A real app reads its catalog from a database.
const PRODUCTS = ['tea', 'coffee', 'biscuits'];

// One sentence for each kind of visitor. The `Record` needs a key for every kind, so the build stops when a later version
// of the SDK adds a kind that is not described here. This app does not turn on anonymous sessions, so it never sees
// `anonymous`.
const SENTENCES: Record<PoppyVisitor['kind'], string> = {
  none: 'Nobody has joined or signed in from this browser.',
  anonymous: 'This browser has an anonymous session.',
  guest: 'An agent is browsing for a user who has not signed in.',
  user: 'A signed-in user is browsing.',
};

// Escapes a value for HTML text. The session card shows values from tokens (`sub`, the URL of the agent, and so on), and a
// person or an agent chooses some of them. The cart shows the `sku` that a visitor sent. No such value goes into the page
// without this.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const css = `
:root { color-scheme: light dark; --bg: #f5f6f8; --card: #fff; --text: #1d2530; --muted: #5f6b7a; --line: #e1e5eb; --accent: #2a62d6;
  --none: #5f6b7a; --anonymous: #1d5fb8; --guest: #a35a00; --user: #12703a; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #11151b; --card: #1a2029; --text: #e7ebf1; --muted: #9ba7b7; --line: #2a323e; --accent: #7ba5ff;
    --none: #9ba7b7; --anonymous: #7ab4ff; --guest: #f0b250; --user: #5fd08c; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1.25rem; }
h1 { margin: 0; font-size: 1.5rem; }
h2 { margin: 0 0 .75rem; font-size: 1rem; }
a { color: var(--accent); }
nav a { margin-left: 1rem; text-decoration: none; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: .75rem; padding: 1.25rem; margin-bottom: 1rem; }
.muted { color: var(--muted); margin: 0; }
.badge { display: inline-block; padding: .1rem .7rem; border: 1px solid currentColor; border-radius: 99px; font-size: .85rem; font-weight: 600; }
.none { color: var(--none); } .anonymous { color: var(--anonymous); } .guest { color: var(--guest); } .user { color: var(--user); }
.lead { margin: .5rem 0 0; font-size: 1.1rem; }
.actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; }
.button, button { padding: .45rem .9rem; border: 1px solid var(--line); border-radius: .5rem; background: var(--card);
  color: var(--accent); font: inherit; text-decoration: none; cursor: pointer; }
.button:hover, button:hover { border-color: var(--accent); }
ul { margin: 0; padding-left: 1.25rem; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .4rem 1rem; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; font: .9rem ui-monospace, monospace; }
footer { color: var(--muted); font-size: .9rem; }
`;

// Adds the item of a button to the cart with the JSON route, then shows the page again. A failure is written in the
// `status` line of the cart card.
const addToCartScript = `
const status = document.getElementById('status');
document.querySelectorAll('[data-sku]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/cart/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: button.dataset.sku }),
      });
      if (res.ok) location.reload();
      else status.textContent = 'Could not add the item (' + res.status + ').';
    } catch {
      status.textContent = 'Could not reach the server.';
    }
  });
});
`;

const layout = (body: string, script = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<title>Shop</title><style>${css}</style></head><body><main>` +
  `<header><h1>Shop</h1><nav><a href="/">Home</a><a href="/orders">Orders</a></nav></header>` +
  `${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;

type Row = [label: string, value: string | undefined];

// The rows for an agent's browser. A guest has a `poppy`, and so has a user whose session an agent joined. `act` is the
// `act` claim of the ID token as Auth0 sent it: `act.sub` is the agent (the URL of its metadata, or the Auth0 id of the
// agent when its client is linked), and the Poppy Session is named by `act.poppy_sid` and `act.poppy_user_id`.
const agentRows = (poppy: PoppyAgentContext): Row[] => [
  ['Poppy Session state', poppy.state],
  ['Poppy Session ID', poppy.act.poppy_sid],
  ['Poppy user ID', poppy.act.poppy_user_id],
  ['Agent', poppy.act.sub],
  ['Cart key', poppy.key],
];

// What the session card shows for each kind of visitor.
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

// The buttons under the sentence. A visitor with a session can log out. Log in is offered to `none` and `anonymous`, who
// have no account yet. It is not offered to a guest: a guest cannot sign in on the website, because the person the agent
// acts for signs in through the agent. A person's login while a guest is there is refused, so the page does not offer
// it. The login button goes to the normal login route, without `iss` or `target_link_uri`, so it is the login of a
// person and not the join of an agent.
function buttons(visitor: PoppyVisitor): string {
  const login =
    visitor.kind === 'none' || visitor.kind === 'anonymous' ? '<a class="button" href="/auth/login">Log in</a>' : '';
  const logout = visitor.kind === 'none' ? '' : '<a class="button" href="/auth/logout">Log out</a>';

  return login || logout ? `<div class="actions">${login}${logout}</div>` : '';
}

// The cart card. `items` is `undefined` when the visitor has no cart.
function cartCard(items: string[] | undefined): string {
  if (items === undefined) {
    return '<section class="card" id="cart"><h2>Cart</h2><p class="muted">Log in to start a cart.</p></section>';
  }

  const list =
    items.length === 0
      ? '<p class="muted">The cart is empty.</p>'
      : `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  const add = PRODUCTS.map(
    (sku) => `<button type="button" data-sku="${escapeHtml(sku)}">Add ${escapeHtml(sku)}</button>`
  ).join('');

  return (
    `<section class="card" id="cart"><h2>Cart (${items.length})</h2>${list}` +
    `<div class="actions">${add}</div><p class="muted" id="status" role="status"></p></section>`
  );
}

// The card with the information of the current session.
function sessionCard(visitor: PoppyVisitor): string {
  const rows: Row[] = [['Visitor', visitor.kind], ...sessionRows(visitor)];
  const shown = rows.filter((row): row is [string, string] => row[1] !== undefined && row[1] !== '');
  const list = shown.map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('');

  return `<section class="card" id="session"><h2>Current session</h2><dl>${list}</dl></section>`;
}

// The home page. `items` is the cart of the visitor, or `undefined` when the visitor has no cart.
export function homePage(visitor: PoppyVisitor, items: string[] | undefined): string {
  return layout(
    `<div class="card"><span class="badge ${visitor.kind}">${visitor.kind}</span>` +
      `<p class="lead">${SENTENCES[visitor.kind]}</p>${buttons(visitor)}</div>` +
      cartCard(items) +
      sessionCard(visitor) +
      '<footer>The same data as JSON: <a href="/api/visitor">/api/visitor</a>, <a href="/api/cart">/api/cart</a></footer>',
    items === undefined ? '' : addToCartScript
  );
}

export const ordersPage = () =>
  layout(
    '<section class="card"><h2>Your orders</h2><p>Your orders are shown here, because you are signed in.</p></section>'
  );
