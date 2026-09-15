# Migrating from `express-openid-connect` to `@auth0/auth0-express`

This example verifies that `@auth0/auth0-express` picks up an existing
`express-openid-connect` session without forcing re-authentication, for both
stateless (cookie) and stateful (Redis) sessions, plus backchannel logout.

## Layout

- `before/` — the legacy app, built with
  [`express-openid-connect`](https://github.com/auth0/express-openid-connect).
- `after/` — the new app, built with `@auth0/auth0-express` and
  `legacyCompatibility` enabled so it reads sessions created by `before/`.
- `shared/` — the Redis `docker-compose.yml` used by the stateful scenario.

Start either app from the repo root with `npm start --workspace <path>`, passing
the folder path shown in the steps below.

Both apps run on `http://localhost:3000` (one at a time) and use the `appSession`
cookie name so the same-browser cookie is picked up across the migration.

## Prerequisites

1. From the repo root: `npm install && npm run build`.
2. A test Auth0 tenant + Regular Web App. In the app settings register:
   - Allowed Callback URLs: `http://localhost:3000/callback` (express-openid-connect)
     and `http://localhost:3000/auth/callback` (auth0-express).
   - Allowed Logout URLs: `http://localhost:3000`.
   - For the backchannel logout test: set the app's **Back-Channel Logout URI** to
     `http://localhost:3000/auth/backchannel-logout` and enable Back-Channel Logout.
3. Copy each app's `.env.example` to `.env` and fill in tenant values. Use the
   **same** session secret in both (`SECRET` in `before/`, `AUTH0_SESSION_SECRET`
   in `after/`).

## Scenario 1 — Stateless (cookie) migration

1. Start the legacy app (no `REDIS_URL` in its `.env`):
   `npm start --workspace examples/migration-express-openid-connect/before`
2. Open `http://localhost:3000`, click Login, complete auth. Confirm home shows
   your user and an `appSession` cookie exists (DevTools → Application → Cookies).
   Note the **Session facts** panel: your `sub`, the token audience/scope, and that
   a refresh + id token are present. (The apps intentionally never print the access
   token itself — it is a bearer secret.)
3. Stop the legacy app (Ctrl-C).
4. Start the new app (no `REDIS_URL` in its `.env`):
   `npm start --workspace examples/migration-express-openid-connect/after`
5. Reload `http://localhost:3000` in the **same browser**. Expected: still logged
   in — the legacy cookie was decrypted, transformed, and re-encrypted in modern
   format. Confirm the **Session facts** match the legacy app's (same `sub`, same
   audience/scope, refresh token still present) — this is what proves the session
   carried over. Confirm `/private` is accessible without a new login.
6. (Optional, strongest proof) With `AUTH0_SECOND_AUDIENCE` set to a second API
   in your tenant, open `/refresh-token`. It exchanges the **carried-over refresh
   token** for a fresh token set — succeeding proves the migrated refresh token is
   intact — and reports the new token set's audience/scope/expiry (never the token).

## Scenario 2 — Stateful (Redis) migration + backchannel logout

1. Start Redis:
   `docker compose -f examples/migration-express-openid-connect/shared/docker-compose.yml up -d`.
2. Set `REDIS_URL=redis://localhost:6379` in BOTH apps' `.env`.
3. Start the legacy app:
   `npm start --workspace examples/migration-express-openid-connect/before`.
   Log in. Confirm a session key exists in Redis:
   `docker compose -f examples/migration-express-openid-connect/shared/docker-compose.yml exec redis redis-cli keys '*'`
4. Stop the legacy app. Start the new app:
   `npm start --workspace examples/migration-express-openid-connect/after`.
5. Reload `http://localhost:3000`. Expected: still logged in (migration store read
   the eoc envelope from Redis, transformed it, and immediately wrote the modern
   `StateData` plus a `logout:sid:<sid>` index back to the same key — no further
   action needed). Confirm the index key exists:
   `... redis-cli keys 'logout:sid:*'`
6. Trigger backchannel logout. In production Auth0 posts this automatically on
   logout elsewhere; to test locally, POST a real `logout_token` obtained from your
   tenant:
   `curl -i -X POST http://localhost:3000/auth/backchannel-logout -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode "logout_token=<JWT>"`
   Expected: `204`. Then confirm both the session key and its `logout:sid:<sid>`
   index are gone from Redis. Reloading `/` shows logged-out.

## Scenario 3 — Aged session survives the absoluteDuration gap

Scenarios 1 and 2 both start from a fresh login, so they never exercise the state
where the migration logs a user out: a session already older than this SDK's default
`absoluteDuration` (3 days) but still valid under express-openid-connect (default 7
days). The migration stores keep the original creation time, so
`createdAt + absoluteDuration` can already be in the past. When it is, the store
treats the session as expired and refuses it on the **first read** — a migrated
cookie still carries express-openid-connect's own `Max-Age`, so the browser keeps
sending it, and the store (not the browser) is what enforces this SDK's cap. The
`after` app sets `absoluteDuration: 604800` to avoid this; this scenario proves that
guard is load-bearing.

1. Log in with the **legacy** app (either store) as in Scenario 1 or 2, then stop it.
2. Simulate an aged session by lowering the cap below the session's age: start the
   `after` app with `SESSION_ABSOLUTE_DURATION=1` (1 second), then reload in the same
   browser. Expected: you are logged out on that first reload for **both** stores —
   the store computes `createdAt + absoluteDuration` in the past and returns no
   session, so `getUser()` is empty and protected routes redirect to login. This is
   the failure the fix prevents.
3. Restart the `after` app without the override (back to the default
   `absoluteDuration: 604800`) and repeat with the original legacy cookie/session
   still present. Expected: still logged in — the aged session is preserved because
   the cap now exceeds its age.

### Notes

- `logout_token` is a signed JWT issued by Auth0; you cannot hand-craft one that
  passes `verifyLogoutToken`. Obtain it from a real logout event (tenant logs /
  a second app), or observe the automatic POST when logging out from another app
  in the same session.
