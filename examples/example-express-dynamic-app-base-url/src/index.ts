import express, { Request, Response, NextFunction } from 'express';
import { createAuth0 } from '@auth0/auth0-express';
import expressLayouts from 'express-ejs-layouts';
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const app = express();

// Fix to use __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Setup view engine. `express-ejs-layouts` wraps each rendered view in
// views/layout.ejs (referenced via the `layout` local), giving every page the
// shared nav plus the "Serving from" host banner.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);

// Mount Auth0 router.
//
// All configuration is read from the environment (AUTH0_DOMAIN,
// AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SESSION_SECRET, APP_BASE_URL),
// so no options are passed here. In particular, `APP_BASE_URL` is a
// comma-separated list, which the SDK treats as an allow-list of origins and
// matches against each request to resolve the correct base URL — so callbacks,
// redirects, and logout use the right origin for each host.
//
// This single app serves two domains (app1.localhost and app2.localhost) on
// the same port using the same Auth0 application.
app.use(createAuth0());

// Middleware to check for session
async function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = await req.auth0.client.getSession();

  if (!session) {
    return res.redirect(`/auth/login?returnTo=${encodeURIComponent(req.url)}`);
  }

  next();
}

// Routes
app.get('/', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('index', { isLoggedIn: !!user, user: user, host: req.headers.host, layout: 'layout' });
});

app.get('/public', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('public', {
    isLoggedIn: !!user,
    user,
    host: req.headers.host,
    layout: 'layout',
  });
});

app.get('/private', requireSession, async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('private', {
    isLoggedIn: !!user,
    user,
    host: req.headers.host,
    layout: 'layout',
  });
});

const start = async () => {
  try {
    app.listen(3000, () => {
      console.log('Server listening on http://app1.localhost:3000 and http://app2.localhost:3000');
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

// Start the server only when this file is run directly (e.g. `npm start`), not
// when it is imported (e.g. by the test suite, which drives `app` via supertest).
if (process.argv[1] === __filename) {
  start();
}
