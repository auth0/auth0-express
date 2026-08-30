import express, { NextFunction, Request, Response } from 'express';
import { createAuth0, startEnterpriseLogin } from '@auth0/auth0-express';
import expressLayouts from 'express-ejs-layouts';
import cookieParser from 'cookie-parser';
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();

// Fix to use __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Setup view engine. `express-ejs-layouts` wraps each rendered view in
// views/layout.ejs (which holds the nav, including the logout link).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);

const APP_SESSION_COOKIE = 'appSession';
const APP_SESSION_SECRET = process.env.APP_SESSION_SECRET as string;
const APP_BASE_URL = process.env.APP_BASE_URL as string;

// In Enterprise Connect mode the SDK writes NO Auth0 session — this app owns
// its own session. We use a signed cookie for it, so cookie-parser MUST be
// mounted with our secret BEFORE createAuth0() (the SDK mounts its own
// secret-less cookie-parser, and cookie-parser no-ops once req.cookies exists).
app.use(cookieParser(APP_SESSION_SECRET));

// Parse the login form (email-based Home Realm Discovery).
app.use(express.urlencoded({ extended: false }));

// The app's session: a signed cookie holding the identity from onCallback.
interface AppSession {
  sub?: string;
  name?: string;
  email?: string;
}

function getSession(req: Request): AppSession | undefined {
  const raw = req.signedCookies?.[APP_SESSION_COOKIE] as string | undefined;
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as AppSession;
  } catch {
    return undefined;
  }
}

// Only allow same-origin, relative redirect targets (prevents open redirects).
function safePath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

// Mount the Auth0 router in Enterprise Connect mode. Auth0 acts as a pure SSO
// relay; onCallback is where we establish our own session.
app.use(
  createAuth0({
    domain: process.env.AUTH0_DOMAIN as string,
    clientId: process.env.AUTH0_CLIENT_ID as string,
    clientSecret: process.env.AUTH0_CLIENT_SECRET as string,
    appBaseUrl: process.env.APP_BASE_URL as string,
    sessionSecret: process.env.AUTH0_SESSION_SECRET as string,
    enterpriseConnect: true,
    onCallback: async (_req, res, { user, appState }) => {
      const session: AppSession = { sub: user?.sub, name: user?.name, email: user?.email };
      res.cookie(APP_SESSION_COOKIE, JSON.stringify(session), {
        httpOnly: true,
        sameSite: 'lax',
        signed: true,
        maxAge: 24 * 60 * 60 * 1000,
      });
      res.redirect(safePath((appState as { returnTo?: string } | undefined)?.returnTo));
    },
  })
);

// Redirect to the home page (email form) when there is no app session.
function requireSession(req: Request, res: Response, next: NextFunction) {
  if (!getSession(req)) {
    res.redirect(`/?returnTo=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  next();
}

// Routes
// The login page (email form) is served at both `/` and `/login`. Logout
// returns users to `/login`, which is registered in Auth0's Allowed Logout URLs.
function renderLogin(req: Request, res: Response) {
  const session = getSession(req);
  res.render('index', {
    isLoggedIn: !!session,
    user: session,
    returnTo: safePath(req.query.returnTo),
    error: typeof req.query.error === 'string' ? req.query.error : undefined,
    layout: 'layout',
  });
}

app.get('/', renderLogin);
app.get('/login', renderLogin);

// Start Enterprise Connect login. startEnterpriseLogin runs WebFinger discovery
// on the email domain and, if federated, redirects to Auth0 and returns true.
// If the domain is not federated it returns false and leaves the response alone.
app.post('/auth/enterprise-login', async (req: Request, res: Response) => {
  const email = (req.body as { email?: string }).email;
  const returnTo = safePath((req.body as { returnTo?: string }).returnTo);

  if (!email) {
    res.redirect('/?error=missing_email');
    return;
  }

  const federated = await startEnterpriseLogin(req, res, { email, returnTo });
  if (!federated) {
    res.redirect(`/?error=not_federated&returnTo=${encodeURIComponent(returnTo)}`);
  }
});

app.get('/public', (req: Request, res: Response) => {
  const session = getSession(req);
  res.render('public', { isLoggedIn: !!session, user: session, layout: 'layout' });
});

app.get('/private', requireSession, (req: Request, res: Response) => {
  const session = getSession(req);
  res.render('private', { isLoggedIn: !!session, user: session, layout: 'layout' });
});

// Clear our session, then federated-logout to end the upstream enterprise IdP
// session. We build the logout URL ourselves (instead of forwarding to the
// SDK's /auth/logout) so we can return the user to /login — the URL registered
// in Auth0's Allowed Logout URLs.
app.get('/logout', async (req: Request, res: Response) => {
  res.clearCookie(APP_SESSION_COOKIE);
  const logoutUrl = await req.auth0.client.logout({
    returnTo: `${APP_BASE_URL}/login`,
    federated: true,
  });
  res.redirect(logoutUrl.href);
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

start();
