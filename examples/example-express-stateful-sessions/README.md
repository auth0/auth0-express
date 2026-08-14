# Express Stateful Sessions Example

This example shows how to use a custom **server-side session store** with
[`@auth0/auth0-express`](../../packages/auth0-express).

By default the SDK stores the whole session encrypted in a cookie (stateless).
Passing a `sessionStore` to `createAuth0` switches to a **stateful** session: the
session data (the authenticated user and tokens) is persisted server-side, and
the cookie only carries an encrypted reference to it. This example uses an
in-memory `Map` (`src/session-store.ts`); in production you would use Redis or a
database so sessions survive restarts and are shared across instances.

## Install dependencies

From the repository root:

```bash
npm install
npm run build
```

## Configuration

Rename `.env.example` to `.env` and fill in the values:

```env
AUTH0_DOMAIN=YOUR_AUTH0_DOMAIN
AUTH0_CLIENT_ID=YOUR_CLIENT_ID
AUTH0_CLIENT_SECRET=YOUR_CLIENT_SECRET
AUTH0_SESSION_SECRET=A_LONG_RANDOM_SECRET
APP_BASE_URL=http://localhost:3000
```

> [!IMPORTANT]
> In the Auth0 Dashboard, add `http://localhost:3000/auth/callback` to **Allowed
> Callback URLs** and `http://localhost:3000` to **Allowed Logout URLs**.

## Run

```bash
npm start
```

Visit http://localhost:3000 and log in. The session data lives in the in-memory
store; because the store is in-memory, sessions are lost when the process
restarts — swap in Redis or a database for durability.

## Test

```bash
npm test
```

Tests unit-test the store directly and drive a fully mocked login, asserting the
session data is persisted server-side rather than in the cookie.
