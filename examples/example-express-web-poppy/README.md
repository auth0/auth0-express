# Express Web Example with Personal Agents (Poppy)

This example shows how a website that uses [`@auth0/auth0-express`](../../packages/auth0-express) lets a Personal Agent browse it. A Personal Agent is software that acts for a user. It drives its own browser, and that browser joins the agent's Poppy Session before it visits your site. The [Poppy (Personal Agent Protocol) 1.0 specification](https://personalagentprotocol.org/docs/1.0/spec#web-browsing) describes this. The support in the SDK is in beta.

## What it shows

The example is a small shop. A route asks `req.auth0.client.poppy.getVisitor()` who is behind the request:

| `kind` | Who is browsing | Cart |
| --- | --- | --- |
| `none` | Nobody has joined or signed in from this browser | None |
| `guest` | An agent's browser that joined, while its user has not signed in | Under `poppy.key` |
| `user` | A signed-in user: a person, or an agent whose user has signed in (`poppy` is then set, and its `state` is `signed_in`) | Under `poppy.key` for an agent, and under the account (`sub`) for a person |

`getVisitor()` can also say `anonymous`. This app does not turn on anonymous sessions, so it never does.

| Route | Answer |
| --- | --- |
| `GET /` | A page with one fixed sentence for the kind of visitor, the number of items in the cart, a **Log in** button (`/auth/login`) for a visitor with no session, a **Log out** button (`/auth/logout`) for a visitor with a session, and a **Current session** section |
| `GET /api/visitor` | `{ kind }`, and `state` when an agent drives the browser |
| `GET /api/cart` | `200` with the items, or `401` when the visitor has no cart |
| `POST /api/cart/items` | `201` with the items, after adding the `sku` of the JSON body. `400` unless the `sku` is a non-empty string, and `401` when the visitor has no cart |
| `GET /orders` | A page for signed-in users. A guest gets `403` and is not sent to the login page. A visitor with no login is sent to it |

The **Current session** section lists what the SDK knows about the visitor: the `kind`, and then the `sub`, name and email of a user, and the state, the ID of the Poppy Session (`act.poppy_sid`), the ID of the user (`act.poppy_user_id`), the agent (`act.sub`: the URL of its metadata, or the Auth0 id of the agent when its client is linked) and the cart key when an agent drives the browser. The page escapes every value, because a person or an agent chooses some of them. The **Log in** button is the normal login of a person, without `iss` or `target_link_uri`. It is not offered to a guest, because a guest cannot sign in on the website, and the login route could bring back the same guest, which the callback refuses. A person's login while a guest is in the browser is refused with `403`, so try the button in a browser that has no guest.

The cart is keyed by `poppy.key`. When the user of the agent signs in, the agent joins the same Poppy Session again, so the key does not change, and the items that it added as a guest are still in the cart. The key is not the user, because a guest has none. It is also not the ID of the Poppy Session alone, because two agents can pick the same one.

`/orders` is closed to guests, because `requiresAuth()` looks for a user and a guest is not a user. It answers a guest with `403` and does not send it to the login page, because the login cannot succeed while a guest is in the browser: the redirect would only send the guest to Auth0 and back to a `403` (`poppy_sign_in_required`). Pass `onGuest` to `requiresAuth()` to answer a guest in your own way. The SDK never writes a guest and a person's session together: a guest join ends the session of a person. A page that must stay closed to a signed-in agent checks `getVisitor()` as well.

The example applies no scopes: `/orders` is open to any signed-in agent with the full access of the account. So the `poppy.json` that you run it with must say `"unscoped": true` in its `web` member. See [Scopes](../../packages/auth0-express/EXAMPLES.md#scopes).

The router also serves `/.well-known/poppy.json` and `/.well-known/oauth-protected-resource` from `poppy.json`. Agents read them to find out how to join. The router touches no cookie to serve them.

## Install dependencies

From the repository root:

```bash
npm install
npm run build
```

## Test

From `examples/example-express-web-poppy`:

```bash
npm test
```

The tests need no Auth0 tenant and no network. `msw` plays the tenant, and each test plays the browser of an agent through the real login and callback routes of the app. They check the discovery files, that a guest keeps its cart when the agent signs in, that a guest gets `403` at the orders page and is not sent to the login page (a visitor with no login is), and that a login link from another issuer is ignored and lands on the home page.

## Run it for real

This needs an Auth0 tenant that is set up for Poppy, and a Personal Agent to browse the site. To try the example without them, run the tests above.

1. Put the `poppy.json` that the Auth0 CLI writes in this folder. The app reads it once, when it starts, from the folder it starts in.

2. Rename `.env.example` to `.env` and fill it in:

   ```bash
   AUTH0_DOMAIN=YOUR_AUTH0_DOMAIN
   AUTH0_CLIENT_ID=YOUR_CLIENT_ID
   AUTH0_CLIENT_SECRET=YOUR_CLIENT_SECRET
   AUTH0_SESSION_SECRET=A_LONG_RANDOM_SECRET
   APP_BASE_URL=https://shop.example.com
   ```

   `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET` are those of the Regular Web Application of the site. `APP_BASE_URL` is the https address of the site: `https://` and the `organization.domain` of `poppy.json`.

3. In the settings of the application, set the **Application Login URI** to `<APP_BASE_URL>/auth/login`, and add `<APP_BASE_URL>/auth/callback` to the **Allowed Callback URLs**. The application also needs the settings that let an agent's browser join: it is a first-party application, it allows the browser join, it accepts session transfer tokens by cookie, and it keeps device binding at `"ip"`. Without them Auth0 refuses the join with an error page. See [Set up Auth0 and the config file](../../packages/auth0-express/EXAMPLES.md#set-up-auth0-and-the-config-file).

4. Serve the site over HTTPS, at the root of the `organization.domain`. Agents look for the two discovery files at the root of that domain, so the site cannot sit under a path. The cookie of a guest is `Secure`, so it needs HTTPS too. The app listens on plain `http`, so put a reverse proxy or a tunnel in front of it that ends TLS and forwards to the app.

5. Start the app, from `examples/example-express-web-poppy`:

   ```bash
   npm start
   ```

   It listens on port 3000. Set `PORT` to use another port, and forward to that port.

6. Use a Personal Agent to browse the site.

## Before you use this in production

- **Use a database.** The carts live in memory, so they are gone when the app stops, they grow without limit, and they are not shared between instances.
- **Protect `POST /api/cart/items` from other sites.** The cookies of the SDK are `SameSite=Lax`, and the route reads only a JSON body, so a form on another site cannot add an item. A real app adds its own protection against cross-site requests as well.

## More

See [Personal Agent Protocol (Poppy)](../../packages/auth0-express/EXAMPLES.md#personal-agent-protocol-poppy) for more on letting Personal Agents browse a website with this package.
