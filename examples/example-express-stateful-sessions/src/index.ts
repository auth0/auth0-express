import express, { Request, Response } from 'express';
import { createAuth0, requiresAuth } from '@auth0/auth0-express';
import expressLayouts from 'express-ejs-layouts';
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemorySessionStore } from './session-store.js';

export const app = express();

// Exported so the test can assert the session was persisted server-side.
export const sessionStore = new InMemorySessionStore();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);

// Mount the Auth0 web router with a custom session store.
//
// Passing `sessionStore` switches the SDK from the default stateless (cookie)
// session to a stateful one: the cookie carries only an opaque session ID, and
// the session data is persisted in `sessionStore` (here, in memory). All other
// configuration (domain, clientId, clientSecret, sessionSecret, appBaseUrl) is
// read from the environment.
app.use(
  createAuth0({
    sessionStore,
  })
);

app.get('/', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  res.render('index', { isLoggedIn: !!user, user, layout: 'layout' });
});

app.get('/public', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  res.render('public', { isLoggedIn: !!user, user, layout: 'layout' });
});

// `requiresAuth()` is the SDK's built-in guard: it redirects browser requests
// to /auth/login (preserving returnTo) and returns 401 for API requests.
app.get('/private', requiresAuth(), async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();
  res.render('private', { isLoggedIn: !!user, user, layout: 'layout' });
});

const start = async () => {
  try {
    app.listen(3000, () => {
      console.log('Server listening on http://localhost:3000');
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
