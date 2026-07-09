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
    issuerBaseURL: process.env.ISSUER_BASE_URL as string,
    baseURL: process.env.BASE_URL as string,
    clientID: process.env.CLIENT_ID as string,
    clientSecret: process.env.CLIENT_SECRET as string,
    secret: process.env.SECRET as string,
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
  const accessToken = req.oidc.accessToken?.access_token;
  res.send(
    user
      ? `<h1>express-openid-connect</h1><p>Logged in as ${user.name ?? user.sub}</p>` +
          `<h2>Access token (audience: ${process.env.AUDIENCE ?? 'none'})</h2>` +
          `<pre style="white-space:pre-wrap;word-break:break-all">${accessToken ?? '(none — set AUDIENCE)'}</pre>` +
          `<h2>User</h2><pre>${JSON.stringify(user, null, 2)}</pre><a href="/logout">Logout</a>`
      : `<h1>express-openid-connect</h1><p>Not logged in</p><a href="/login">Login</a>`
  );
});

app.get('/private', requiresAuth(), (req, res) => {
  res.send(`<h1>Private</h1><pre>${JSON.stringify(req.oidc.user, null, 2)}</pre>`);
});

app.listen(3000, () => {
  console.log(`express-openid-connect app on http://localhost:3000 (store: ${store ? 'redis' : 'cookie'})`);
});
