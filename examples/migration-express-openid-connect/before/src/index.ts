import express from 'express';
// express-openid-connect is CommonJS; import the default and destructure so Node's
// ESM loader doesn't fail on named-export detection for the CJS module.
import openidConnect from 'express-openid-connect';
const { auth, requiresAuth } = openidConnect;
import 'dotenv/config';
import { createRedisStore } from './redis-store.js';

const app = express();

const redisUrl = process.env.REDIS_URL;
const store = redisUrl ? await createRedisStore(redisUrl) : undefined;

app.use(
  auth({
    // issuerBaseURL, baseURL, clientID, clientSecret and secret are read from the
    // ISSUER_BASE_URL / BASE_URL / CLIENT_ID / CLIENT_SECRET / SECRET env vars by
    // express-openid-connect, so we only spell out what is specific to this example.
    authRequired: false,
    // express-openid-connect needs a client secret + response_type=code to obtain tokens.
    // Requesting an audience makes Auth0 issue an API access token (offline_access adds a
    // refresh token). auth0-express must be configured with the SAME audience so the carried
    // over token set is found by getAccessToken.
    authorizationParams: {
      response_type: 'code',
      scope: 'openid profile email offline_access',
      audience: process.env.AUDIENCE as string,
    },
    // Default session cookie name is 'appSession' — keep it so auth0-express can pick it up.
    session: store ? { store } : {},
  })
);

app.get('/', (req, res) => {
  const user = req.oidc.user;
  if (!user) {
    return res.send(`<h1>express-openid-connect</h1><p>Not logged in</p><a href="/login">Login</a>`);
  }

  // We never render the access token itself — it is a bearer secret. Instead we show the same
  // non-secret facts the after/ app shows, so you can compare the two side by side and confirm
  // the session carried over: same user `sub`, same audience/scope, refresh token still present.
  const accessToken = req.oidc.accessToken;
  const expiresAt = accessToken?.expires_in ? new Date((Math.floor(Date.now() / 1000) + accessToken.expires_in) * 1000).toISOString() : '(unknown)';
  res.send(
    `<h1>express-openid-connect</h1><p>Logged in as ${user.name ?? user.sub}</p>` +
      `<h2>Session facts</h2>` +
      `<ul>` +
      `<li>Access token present: <b>${accessToken?.access_token ? 'yes' : 'no'}</b> (audience: ${process.env.AUDIENCE ?? 'none'})</li>` +
      `<li>Scope requested: <b>openid profile email offline_access</b></li>` +
      `<li>Access token expires (UTC): <b>${expiresAt}</b></li>` +
      `<li>Refresh token present: <b>${req.oidc.refreshToken ? 'yes' : 'no'}</b></li>` +
      `<li>ID token present: <b>${req.oidc.idToken ? 'yes' : 'no'}</b></li>` +
      `</ul>` +
      `<h2>User</h2><pre>${JSON.stringify(user, null, 2)}</pre><a href="/logout">Logout</a>`
  );
});

app.get('/private', requiresAuth(), (req, res) => {
  res.send(`<h1>Private</h1><pre>${JSON.stringify(req.oidc.user, null, 2)}</pre>`);
});

app.listen(3000, () => {
  console.log(`express-openid-connect app on http://localhost:3000 (store: ${store ? 'redis' : 'cookie'})`);
});
