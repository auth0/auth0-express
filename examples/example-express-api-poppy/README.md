# Express API Example with Personal Agents (Poppy)

This example shows how to serve Personal Agents with [`@auth0/auth0-express-api`](../../packages/auth0-express-api). A Personal Agent is software that acts for a user. It signs every request to your API with a `Poppy-Session` header (a Poppy Session), and once its user has signed in, it sends an access token as well. The [Poppy (Personal Agent Protocol) 0.3 specification](https://personalagentprotocol.org/docs/0.3/spec) describes this. The support in the SDK is in beta.

## What it shows

The example is a small shop API with three routes. The table shows what an agent gets before its user has signed in (it sends a Session and no access token) and after (it sends both):

| Route | Signed out | Signed in |
| --- | --- | --- |
| `GET /api/cart` | `200` with the items in the cart | The same |
| `POST /api/cart/items` | `201` with the cart, after adding the `sku` of the JSON body (`400` unless the body has a `sku` that is a non-empty string) | The same |
| `POST /api/orders` | `401`, with challenges that name the `orders:write` scope, so the agent knows what to sign in for | `201` with the account (`sub`) and the items, and the cart is emptied |

Every route sets `poppy: { requireSession: true }` on `requiresAuth()`, so a request needs a verified Session. `POST /api/orders` also sets `scopes: 'orders:write'`, so it needs an access token with that scope too.

The cart belongs to the Session. It is keyed by `req.auth0.poppy.key`. When the user signs in, the agent adds an access token to the same Session, so the key does not change, and the items it added while signed out are still there when it places the order. The key is not the user, because a signed-out request has none. It is also not the Session ID alone, because two agents can pick the same one.

The order has the `sub` of the access token, which is the account. `req.auth0.poppy.userId` is not the account: it is the pseudonymous User ID that the agent gave its user for this API, and the example never uses it as one.

The app passes a `sessionStore` to the `poppy` option. The SDK keeps no Session records on its own, so without a store it cannot see that a known Session ID came back with another User ID, and the cart, which is keyed by `poppy.key`, would be shared by two users ([spec 5.3, step 4](https://personalagentprotocol.org/docs/0.3/spec#session-verification)). With the store, the SDK refuses such a Session, and a Session that the store has marked as ended. The test `refuses a Session whose user changed` fails without it. `MemoryPoppySessionStore` is the same store as the one in [Session records](../../packages/auth0-express-api/EXAMPLES.md#session-records).

## Install dependencies

From the repository root:

```bash
npm install
npm run build
```

## Test

From `examples/example-express-api-poppy`:

```bash
npm test
```

The tests need no Auth0 tenant and no network. A test agent from `@auth0/auth0-express-api/testing` signs the `Poppy-Session` headers, and `msw` serves the discovery document and the keys of the tenant. The tests add to a cart while signed out, place the order from the same cart once signed in, and refuse a Session that is not valid.

## Run it for real

This needs an Auth0 tenant that is set up for Poppy, and a Personal Agent to call the API. To try the example without them, run the tests above.

1. Rename `.env.example` to `.env` and fill it in:

   ```env
   AUTH0_DOMAIN=YOUR_AUTH0_DOMAIN
   AUTH0_AUDIENCE=YOUR_API_IDENTIFIER
   API_PUBLIC_ORIGIN=https://shop.example.com
   POPPY_AGENTS=https://agent.example/agent.json
   ```

   `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` are the domain of your tenant and the identifier of your API. The `aud` of every Session JWT must be the issuer of that domain: `https://`, then the domain, then `/`. The SDK works that out, so you do not set it.

   `POPPY_AGENTS` lists the agents you accept, as URLs separated by commas. Replace the sample URL with the URL of the agent you accept. It is optional, but see [Before you use this in production](#before-you-use-this-in-production).

2. Set `API_PUBLIC_ORIGIN` to the address that agents call. It must be an `https` origin with no path, and the app does not start without it. It is passed to the SDK as the `publicOrigin` of the `poppy` option. Agents sign each Session for that address and the path they call, and the app checks the Session against `API_PUBLIC_ORIGIN` and the path of the request, never against the `Host` header. The app listens on plain `http`, so to run it on your machine, put a reverse proxy or a tunnel in front of it that ends TLS and forwards to the app, and use its `https` address as `API_PUBLIC_ORIGIN`.

3. Start the app, from `examples/example-express-api-poppy`:

   ```bash
   npm start
   ```

   It listens on port 3000. Set `PORT` to use another port, and forward to that port.

4. Use a Personal Agent to call the API. Every route needs a `Poppy-Session` header that a Personal Agent signs. The tests show what its requests look like.

## Before you use this in production

Before you use this pattern in production:

- **List your agents.** Keep only the agents you accept in `POPPY_AGENTS`. Without a list, any public HTTPS agent URL in a Session makes the app fetch that agent's metadata.
- **Rate limit by agent.** The SDK does no rate limiting. Limit by the verified `req.auth0.poppy.agent.cimdUrl`, and answer a request over the limit with 429 and a `Retry-After` header ([spec 5.6](https://personalagentprotocol.org/docs/0.3/spec#sending-requests)).
- **Make the POST routes safe to repeat.** A copied `Poppy-Session` header works again within the `iatWindow` (60 seconds by default), and `POST /api/cart/items` and `POST /api/orders` change state. A real app takes an idempotency key. The SDK keeps no store of used Session JWT `jti`s, although [spec 5.3](https://personalagentprotocol.org/docs/0.3/spec#session-verification) allows refusing a reused one.
- **Use a database.** The carts and the Session store live in memory, so they are gone when the app stops, they grow without limit, and they are not shared between instances.

## More

See [Personal Agents (Poppy)](../../packages/auth0-express-api/EXAMPLES.md#personal-agents-poppy) for more on serving Personal Agents with this package, and its [Production notes](../../packages/auth0-express-api/EXAMPLES.md#production-notes) before you go live.
