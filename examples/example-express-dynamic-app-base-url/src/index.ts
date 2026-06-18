import express, { Request, Response, NextFunction } from 'express';
import { createAuth0 } from '@auth0/auth0-express';
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();

// Fix to use __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Setup view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Mount Auth0 router.
//
// Note that `appBaseUrl` is intentionally NOT passed here. Instead, the SDK
// reads `APP_BASE_URL` from the environment. When that value is a
// comma-separated list, the SDK treats it as an allow-list of origins and
// resolves the correct base URL per request by matching the incoming origin.
//
// This single app serves two domains (app1.localhost and app2.localhost) on
// the same port using the same Auth0 application.
app.use(
  createAuth0({
    domain: process.env.AUTH0_DOMAIN as string,
    clientId: process.env.AUTH0_CLIENT_ID as string,
    clientSecret: process.env.AUTH0_CLIENT_SECRET as string,
    sessionSecret: process.env.AUTH0_SESSION_SECRET as string,
  })
);

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

start();
