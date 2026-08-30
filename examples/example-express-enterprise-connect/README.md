# Express Enterprise Connect Example

This example demonstrates **Enterprise Connect (EC)** with the `auth0-express` package. In EC mode Auth0 acts as a pure SSO relay: it writes **no Auth0 session** — the application owns its own session.

Three pieces make up the EC surface:

- `enterpriseConnect: true` — puts the SDK in relay mode (no session store; identity-only methods).
- `startEnterpriseLogin(req, res, { email })` — runs email-domain [WebFinger](https://openid.net/specs/openid-connect-discovery-1_0.html) discovery and, if the domain is federated, redirects to Auth0. Returns `true` when it redirected, `false` when the domain is not federated.
- `onCallback` — required in EC mode. Called after the code exchange with the resolved identity; this is where the app writes its **own** session and ends the response.

## How this example works

1. The home page shows an **email form** (Home Realm Discovery by email domain).
2. `POST /auth/enterprise-login` calls `startEnterpriseLogin`. Federated domains are redirected to Auth0; non-federated domains return to the form with an error.
3. After Auth0 relays the enterprise login back to `/auth/callback`, `onCallback` writes the identity into a **signed cookie** (`appSession`) — the app's own session — and redirects.
4. `/private` is guarded by a small `requireSession` middleware that reads that cookie. Note the SDK's `requiresAuth()` / `getUser()` are **not** available in EC mode (they throw `EnterpriseConnectNotSupportedError`), because there is no Auth0 session to read.
5. `/logout` clears the app cookie, then calls `req.auth0.client.logout({ returnTo, federated: true })` and redirects to the resulting URL — a **federated** logout that also ends the upstream enterprise IdP session. It returns the user to `/login` (which must be in the tenant's Allowed Logout URLs).

> Cookie order matters: `cookie-parser` is mounted with the app secret **before** `createAuth0()`. The SDK mounts its own secret-less `cookie-parser`, and `cookie-parser` no-ops once `req.cookies` exists — so the app's parser (with the secret) must run first for signed cookies to work.

## Install dependencies

```bash
npm install
```

## Configuration

Rename `.env.example` to `.env` and fill in the values:

```ts
AUTH0_DOMAIN=YOUR_AUTH0_DOMAIN
AUTH0_CLIENT_ID=YOUR_AUTH0_CLIENT_ID
AUTH0_CLIENT_SECRET=YOUR_AUTH0_CLIENT_SECRET
AUTH0_SESSION_SECRET=YOUR_AUTH0_SESSION_SECRET
APP_BASE_URL=http://localhost:3000
APP_SESSION_SECRET=YOUR_APP_SESSION_SECRET
```

`AUTH0_SESSION_SECRET` encrypts the SDK's transaction cookie; `APP_SESSION_SECRET` signs this app's own session cookie. Generate secrets with:

```shell
openssl rand -hex 64
```

In the Auth0 Dashboard (Applications → your app) also set:

- **Allowed Callback URLs**: `http://localhost:3000/auth/callback`
- **Allowed Logout URLs**: `http://localhost:3000/login`

And your tenant must have an **Enterprise connection** set up with Home Realm Discovery so the email domain resolves to a federated identity provider.

## Run

```bash
npm run start
```

The application has these routes:

- `/` and `/login`: Home — email sign-in form (or a greeting once signed in). Both serve the same page; logout returns here.
- `/auth/enterprise-login`: Receives the email form and calls `startEnterpriseLogin`.
- `/public`: A public route that can be accessed without authentication.
- `/private`: A private route guarded by the app's own session.
- `/logout`: Clears the app session and performs a federated logout.

## Alternative: composing `isFederatedDomain` + login yourself

`startEnterpriseLogin` is a convenience that folds two steps together: the WebFinger discovery check and starting the login. If you want that control yourself — for example, to run custom logic between the two — the SDK also re-exports the standalone `isFederatedDomain` function. You then start the login by redirecting to the SDK's `/auth/login` route, forwarding the email as `login_hint` (`login_hint` is not a reserved parameter, so `/auth/login` passes it through to `/authorize`):

```ts
import { isFederatedDomain } from '@auth0/auth0-express';

app.post('/auth/enterprise-login', async (req, res) => {
  const email = req.body.email;
  const emailDomain = email?.split('@')[1];

  // (1) Home Realm Discovery — resolve the email domain via WebFinger.
  const federated = emailDomain
    ? await isFederatedDomain(process.env.AUTH0_DOMAIN, emailDomain)
    : false;

  if (!federated) {
    res.redirect('/?error=not_federated');
    return;
  }

  // (2) Start the login, forwarding the email as login_hint.
  res.redirect(`/auth/login?login_hint=${encodeURIComponent(email)}`);
});
```

This is equivalent to calling `startEnterpriseLogin(req, res, { email })`. Prefer the single helper unless you specifically need to intervene between the discovery and login steps — it can't be called without the discovery check, so there's no way to accidentally skip it.
