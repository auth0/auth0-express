# migration-after (new app)

The "after" app for migration verification, built with `@auth0/auth0-express` and
`legacyCompatibility` enabled so it reads sessions created by the `before/`
(`express-openid-connect`) app.

Runs on `http://localhost:3000`. Session cookie name is forced to `appSession` to
match the legacy app. Stateless (cookie) by default; set `REDIS_URL` for the
stateful (Redis) scenario. Backchannel logout is mounted at
`/auth/backchannel-logout`.

See [`../README.md`](../README.md) for the full end-to-end runbook. Copy
`.env.example` to `.env` and fill in tenant values first.
