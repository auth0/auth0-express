# migration-before (legacy app)

The "before" app for migration verification, built with
[`express-openid-connect`](https://github.com/auth0/express-openid-connect).

Runs on `http://localhost:3000`. Default session cookie name `appSession`.
Stateless (cookie) by default; set `REDIS_URL` to store sessions in Redis.

See [`../README.md`](../README.md) for the full end-to-end runbook. Copy
`.env.example` to `.env` and fill in tenant values first.
