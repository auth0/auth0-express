import express, { Request, Response, NextFunction } from 'express';
import { createAuth0 } from '@auth0/auth0-express';
import expressLayouts from 'express-ejs-layouts';
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);

// Base URL of the resource server this app calls on the user's behalf.
//
// This example calls a SEPARATE API service. The API example in this repo
// (examples/example-express-api) is a ready-made resource server protected by
// @auth0/auth0-express-api — run it alongside this app (see the README) and
// point API_BASE_URL at it.
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

// Mount the Auth0 web router.
//
// Passing `audience` makes the SDK request an access token for that API when
// the user logs in. The token is then available via `getAccessToken()` and is
// used below to call the resource server on the user's behalf. Everything else
// (clientId, clientSecret, sessionSecret, appBaseUrl) is read from the
// environment by the SDK.
app.use(
  createAuth0({
    audience: process.env.AUTH0_AUDIENCE as string,
  })
);

// Redirect to login if there is no active session.
async function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = await req.auth0.client.getSession();
  if (!session) {
    return res.redirect(`/auth/login?returnTo=${encodeURIComponent(req.url)}`);
  }
  next();
}

app.get('/', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  res.render('index', { isLoggedIn: !!user, user, layout: 'layout' });
});

app.get('/public', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  res.render('public', { isLoggedIn: !!user, user, layout: 'layout' });
});

app.get('/private', requireSession, async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  res.render('private', { isLoggedIn: !!user, user, layout: 'layout' });
});

// Call the resource server on behalf of the logged-in user.
//
// 1. `getAccessToken()` returns an access token for the configured `audience`
//    (requesting/refreshing it as needed).
// 2. We call the API with the token in the `Authorization` header.
// 3. The API validates the token and returns data, which we render.
app.get('/call-api', requireSession, async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  const { accessToken } = await req.auth0.client.getAccessToken();

  const response = await fetch(`${apiBaseUrl}/api/private`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const apiResponse = await response.text();

  res.render('api', {
    isLoggedIn: !!user,
    user,
    audience: process.env.AUTH0_AUDIENCE,
    apiResponse,
    layout: 'layout',
  });
});

const start = async () => {
  try {
    app.listen(3000, () => {
      console.log('Web server listening on http://localhost:3000');
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

// Start the server only when run directly (`npm start`), not when imported by
// the test suite (which drives `app` via supertest).
if (process.argv[1] === __filename) {
  start();
}
