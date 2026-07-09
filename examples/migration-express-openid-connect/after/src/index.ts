import express, { Request, Response, NextFunction } from 'express';
import { createAuth0 } from '@auth0/auth0-express';
import 'dotenv/config';
import { createRedisSessionStore } from './redis-store.js';

const app = express();

const redisUrl = process.env.REDIS_URL;
const sessionStore = redisUrl ? await createRedisSessionStore(redisUrl) : undefined;

// Auth0 sends the backchannel logout token as application/x-www-form-urlencoded.
// Express 5 does not parse request bodies by default, so mount a parser before the
// Auth0 router or `POST /auth/backchannel-logout` would see an undefined `req.body`.
app.use(express.urlencoded({ extended: false }));

app.use(
  createAuth0({
    domain: process.env.AUTH0_DOMAIN as string,
    clientId: process.env.AUTH0_CLIENT_ID as string,
    clientSecret: process.env.AUTH0_CLIENT_SECRET as string,
    appBaseUrl: process.env.APP_BASE_URL as string,
    sessionSecret: process.env.AUTH0_SESSION_SECRET as string,
    // Must equal the audience express-openid-connect requested — getAccessToken looks up the
    // token set by audience, so a mismatch means the carried-over token is not found.
    audience: process.env.AUTH0_AUDIENCE,
    // Read sessions written by express-openid-connect.
    legacyCompatibility: {
      enabled: true,
      legacySecret: process.env.AUTH0_SESSION_SECRET as string,
      legacyScope: 'openid profile email offline_access',
      // The migration transformer stamps the legacy access token with this audience. It must
      // match the `audience` above so getAccessToken finds the transformed token set.
      legacyAudience: process.env.AUTH0_AUDIENCE,
    },
    // Match express-openid-connect's default cookie name so the same-browser cookie is picked up.
    sessionConfiguration: { cookie: { name: 'appSession' } },
    // Only set for the stateful scenario; undefined => cookie (stateless) store.
    sessionStore,
  })
);

async function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = await req.auth0.client.getSession();
  if (!session) return res.redirect(`/auth/login?returnTo=${encodeURIComponent(req.url)}`);
  next();
}

// We never render the access token itself — it is a bearer secret and does not belong in a
// page. To confirm the session carried over from express-openid-connect we show non-secret
// facts about it: the user identity, and each token set's audience / scope / expiry plus
// whether a refresh + id token are present. Matching these against the legacy app's `/` page
// (same `sub`, same audience/scope, refresh token still present) proves the migration worked.
function renderSessionFacts(user: Record<string, unknown>, session: { tokenSets?: Array<{ audience: string; scope?: string; expiresAt: number }>; refreshToken?: string; idToken?: string }) {
  const tokenSets = session.tokenSets ?? [];
  const rows = tokenSets
    .map(
      (t) =>
        `<tr><td>${t.audience}</td><td>${t.scope ?? '(none)'}</td>` +
        `<td>${new Date(t.expiresAt * 1000).toISOString()}</td></tr>`
    )
    .join('');
  return (
    `<h1>auth0-express</h1><p>Logged in as ${user.name ?? user.sub}</p>` +
    `<h2>Session facts</h2>` +
    `<ul>` +
    `<li>Refresh token present: <b>${session.refreshToken ? 'yes' : 'no'}</b></li>` +
    `<li>ID token present: <b>${session.idToken ? 'yes' : 'no'}</b></li>` +
    `<li>Token sets: <b>${tokenSets.length}</b></li>` +
    `</ul>` +
    (tokenSets.length
      ? `<table border="1" cellpadding="4"><thead><tr><th>Audience</th><th>Scope</th><th>Expires (UTC)</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p>(no token sets)</p>`) +
    `<h2>User</h2><pre>${JSON.stringify(user, null, 2)}</pre>` +
    `<p><a href="/auth/logout">Logout</a></p>`
  );
}

app.get('/', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  if (!user) {
    return res.send(`<h1>auth0-express</h1><p>Not logged in</p><a href="/auth/login">Login</a>`);
  }

  const session = await req.auth0.client.getSession();
  res.send(renderSessionFacts(user as Record<string, unknown>, session ?? {}));
});

app.get('/private', requireSession, async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  res.send(`<h1>Private</h1><pre>${JSON.stringify(user, null, 2)}</pre>`);
});

// Forces a session write to observe the cookie migrating to the modern format, and proves the
// carried-over refresh token still works. Requesting a token for a *different* audience misses
// the cached token set, so the SDK exchanges the carried-over refresh token and then calls
// stateStore.set() — which re-encrypts (migrates) the appSession cookie. A successful exchange
// is the strongest signal that the token set migrated intact. We report the new token's
// metadata (audience / scope / expiry) rather than the token itself. Reload / afterwards to
// confirm the original session survived the rewrite. Requires AUTH0_SECOND_AUDIENCE to be a
// second API registered in the tenant that this client is authorized for.
app.get('/refresh-token', requireSession, async (req: Request, res: Response) => {
  const secondAudience = process.env.AUTH0_SECOND_AUDIENCE;
  if (!secondAudience) {
    return res.status(400).send('Set AUTH0_SECOND_AUDIENCE to a different API identifier to run this.');
  }
  try {
    const result = await req.auth0.client.getAccessToken({ audience: secondAudience });
    res.send(
      `<h1>Refresh succeeded — session written</h1>` +
        `<p>Requested a token for a second audience, forcing the SDK to exchange the ` +
        `carried-over refresh token and call stateStore.set() — the appSession cookie has now ` +
        `been re-encrypted in the modern format. The exchange succeeding proves the migrated ` +
        `refresh token is valid.</p>` +
        `<h2>New token set</h2>` +
        `<ul>` +
        `<li>Audience: <b>${result.audience}</b></li>` +
        `<li>Scope: <b>${result.scope ?? '(none)'}</b></li>` +
        `<li>Expires (UTC): <b>${new Date(result.expiresAt * 1000).toISOString()}</b></li>` +
        `</ul>` +
        `<a href="/">Back to home (confirm original session + audience token still there)</a>`
    );
  } catch (e) {
    res.status(400).send(`getAccessToken for '${secondAudience}' failed: ${(e as Error).message}`);
  }
});

app.listen(3000, () => {
  console.log(`auth0-express app on http://localhost:3000 (store: ${sessionStore ? 'redis' : 'cookie'})`);
});
