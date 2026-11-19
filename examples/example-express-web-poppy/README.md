# Express Web Example with Personal Agents (Poppy)

A small shop that lets a Personal Agent browse it, built with [`@auth0/auth0-express`](../../packages/auth0-express).

A Personal Agent is software that acts for a user. It drives its own browser, and that browser joins the agent's Poppy Session before it visits your site. The [Poppy (Personal Agent Protocol) specification](https://personalagentprotocol.org/docs/spec#web-browsing) describes this. The support in the SDK is in beta.

The home page shows who is browsing, what is in their cart, and what the SDK knows about them. Use it to see the SDK at work.

## Quick start: install, build and run the tests

From the repository root:

```bash
npm install
npm run build
```

Then, from `examples/example-express-web-poppy`:

```bash
npm test
```

The tests need no Auth0 tenant and no network. `msw` plays the tenant, and each test plays the browser of an agent through the real login and callback routes. [`src/app.spec.ts`](./src/app.spec.ts) is a good place to see what an agent's join looks like.

## Where to look

| File | What is in it |
| --- | --- |
| [`src/app.ts`](./src/app.ts) | All the SDK code, in four steps. Start here. |
| [`src/views.ts`](./src/views.ts) | The HTML and CSS of the pages. No SDK code. |
| [`src/index.ts`](./src/index.ts) | Reads `.env` and starts the server. |

The four steps are in `src/app.ts`:

```ts
// 1. Turn on support for Personal Agents.
app.use(createAuth0({ poppy: true }));

app.get('/', async (req, res) => {
  // 2. Who is browsing?
  const visitor = await req.auth0.client.poppy.getVisitor();
  // 3. Which cart is theirs?
  const key = cartKey(visitor);
  // ...
});

// 4. Keep a page for signed-in users.
app.get('/orders', requiresAuth(), (req, res) => { /* ... */ });
```

## Who is browsing

`getVisitor()` answers with a `kind`:

| `kind` | Who is browsing | Cart |
| --- | --- | --- |
| `none` | Nobody has joined or signed in from this browser | None |
| `guest` | An agent's browser that joined, while its user has not signed in | Under `poppy.key` |
| `user` | A signed-in user: a person, or an agent whose user has signed in (`poppy` is then set, and its `state` is `signed_in`) | Under `poppy.key` for an agent, and under the account (`sub`) for a person |

`getVisitor()` can also say `anonymous`. This app does not turn on anonymous sessions, so it never does.

## Routes

| Route | Answer |
| --- | --- |
| `GET /` | The home page: the kind of visitor, the cart (with buttons to add items when the visitor has one), and the **Current session** card. **Log in** is shown when nobody has joined or signed in, and **Log out** to a visitor with a session |
| `GET /api/visitor` | `{ kind }`, and `state` when an agent drives the browser |
| `GET /api/cart` | `200` with the items, or `401` when the visitor has no cart |
| `POST /api/cart/items` | Adds the `sku` of the JSON body. `201` with the items, `400` unless the `sku` is a non-empty string, `401` when the visitor has no cart |
| `GET /orders` | A page for signed-in users. A guest gets `403` and is not sent to the login page. A visitor with no login is sent to it. The **Orders** link in the page header goes here, so you can see both |

## Run it for real

This needs an Auth0 tenant that is set up for Poppy (it is in beta, so your tenant needs it enabled), and a Personal Agent to browse the site. Do the install and build from the quick start first.

1. Set up the application with the Auth0 CLI, from this folder:

   ```bash
   auth0 poppy setup --company-domain <your-domain>
   auth0 poppy config
   ```

   `auth0 poppy setup` configures the application for the browser join of an agent, asks you for its **Application Login URI** (give it `<APP_BASE_URL>/auth/login`), and writes `poppy.json`. `auth0 poppy config` writes the file again from the tenant. The app reads `poppy.json` once, when it starts, from the folder it starts in. Keep `<APP_BASE_URL>/auth/callback` in the **Allowed Callback URLs** of the application. Without the setup, Auth0 refuses the join with an error page. See [Set up Auth0 and the config file](../../packages/auth0-express/EXAMPLES.md#set-up-auth0-and-the-config-file).

2. Rename `.env.example` to `.env` and fill it in:

   ```bash
   AUTH0_DOMAIN=YOUR_AUTH0_DOMAIN
   AUTH0_CLIENT_ID=YOUR_CLIENT_ID
   AUTH0_CLIENT_SECRET=YOUR_CLIENT_SECRET
   AUTH0_SESSION_SECRET=A_LONG_RANDOM_SECRET
   APP_BASE_URL=https://shop.example.com
   # AUTH0_AUDIENCE=https://shop.example.com/api
   ```

   `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET` are those of the Regular Web Application of the site. `AUTH0_SESSION_SECRET` encrypts the session cookie: make one with `openssl rand -hex 64`. `APP_BASE_URL` is the https address of the site: `https://` and the `organization.domain` of `poppy.json`. Set `AUTH0_AUDIENCE` (the line is commented out) to the identifier of the API of the agent's access token when your tenant has no default audience, or one that is another API: without it, the sign-in of the user of an agent fails with a `500` (see [The audience of your login route](../../packages/auth0-express/EXAMPLES.md#the-audience-of-your-login-route)).

3. Serve the site over HTTPS, at the root of the `organization.domain`. Agents look for the two discovery files at the root of that domain, so the site cannot sit under a path. The cookie of a guest is `Secure`, so it needs HTTPS too. The app listens on plain `http`, so put a reverse proxy or a tunnel in front of it that ends TLS and forwards to the app.

4. Start the app, from this folder:

   ```bash
   npm start
   ```

   It listens on port 3000. Set `PORT` to use another port, and forward to that port. If a setting of `.env`, or `poppy.json`, is missing, it says so and stops.

5. Use a Personal Agent to browse the site, and look at the home page in the same browser to see what the SDK knows.

## Good to know

- **The cart can survive the sign-in.** The cart is keyed by `poppy.key`, a hash of `act.sub`, `act.poppy_sid` and `act.poppy_user_id`. When the user of the agent signs in, the agent joins again, and while the three values are the same, the key is the same, so the items that the agent added as a guest are still there. When one of them differs, the key is another one and the cart of the guest is not found, so keep under it only what you can afford to lose. The key is not the user, because a guest has none. It is also not the ID of the Poppy Session alone, because two agents can pick the same one.
- **Guests cannot use `/orders`.** `requiresAuth()` looks for a user, and a guest is not a user, so it answers a guest with `403`. It does not send the guest to the login page, because a login cannot sign a guest in as a user, so the redirect is no use (`poppy_sign_in_required`). Pass `onGuest` to `requiresAuth()` to answer a guest in your own way. A page that must stay closed to a signed-in agent checks `getVisitor()` as well.
- **A guest has no `Log in` button.** A guest cannot sign in on the website. The person the agent acts for signs in through the agent. A person's login while a guest is in the browser is refused with `403`, so try **Log in** in a browser that has no guest. The button is the normal login of a person, without `iss` or `target_link_uri`.
- **No answer is cached.** Every answer except the two discovery files carries `Cache-Control: no-store`, because what it says depends on the cookies of the visitor, and a shared cache such as a CDN must not give the answer for one visitor to another. The router sets `public, max-age=300` on the discovery files.
- **Every value is escaped.** The page shows values that a person or an agent chooses (the `sub`, the URL of the agent, the items of the cart), so `src/views.ts` escapes each one.
- **No scopes.** The example applies no scopes: `/orders` is open to any signed-in agent with the full access of the account. So the `poppy.json` that you run it with must say `"unscoped": true` in its `web` member. See [Scopes](../../packages/auth0-express/EXAMPLES.md#scopes).
- **Discovery files.** The router serves `/.well-known/poppy.json` and `/.well-known/oauth-protected-resource` from `poppy.json`. Agents read them to find out how to join. The router touches no cookie to serve them.

## Before you use this in production

- **Use a database.** The carts live in memory, so they are gone when the app stops, they grow without limit, and they are not shared between instances.
- **Protect `POST /api/cart/items` from other sites.** The cookies of the SDK are `SameSite=Lax`, and the route reads only a JSON body, so a form on another site cannot add an item. A real app adds its own protection against cross-site requests as well.

## More

See [Personal Agent Protocol (Poppy)](../../packages/auth0-express/EXAMPLES.md#personal-agent-protocol-poppy) for more on letting Personal Agents browse a website with this package.
