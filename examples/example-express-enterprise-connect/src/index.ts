import express, { NextFunction, Request, Response } from 'express';
import { createAuth0, startEnterpriseLogin } from '@auth0/auth0-express';
import expressLayouts from 'express-ejs-layouts';
import cookieParser from 'cookie-parser';
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);

const APP_SESSION_COOKIE = 'app_session';
const APP_BASE_URL = process.env.APP_BASE_URL as string;

// HMAC helpers — sign and verify the app session cookie so it can't be forged.
const enc = new TextEncoder();
const key = () =>
  crypto.subtle.importKey(
    'raw',
    enc.encode(process.env.AUTH0_SESSION_SECRET!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

// cookie-parser must be registered before createAuth0 so `req.cookies` is populated.
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

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
    appBaseUrl: APP_BASE_URL,
    sessionSecret: process.env.AUTH0_SESSION_SECRET as string,
    enterpriseConnect: true,
    // Fired by the mounted /auth/callback route. Auth0 writes nothing —
    // create your own session here, then end the response.
    async onCallback(_req, res, { user, appState }) {
      if (!user) {
        return res.redirect('/login?error=no-session');
      }

      const orgId = (user['org_id'] as string) ?? '';
      // Optional: validate orgId against your approved-org list before continuing.

      // user holds the OIDC claims; keep only the fields you need.
      const appSession = { sub: user.sub, email: user.email, name: user.name, orgId };

      // Sign the payload so the cookie can't be forged: "<body>.<signature>".
      const body = Buffer.from(JSON.stringify(appSession)).toString('base64url');
      const signature = Buffer.from(
        await crypto.subtle.sign('HMAC', await key(), enc.encode(body))
      ).toString('base64url');

      res.cookie(APP_SESSION_COOKIE, `${body}.${signature}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      res.redirect(safePath((appState as { returnTo?: string } | undefined)?.returnTo));
    },
  })
);

async function getAppSession(req: Request) {
  const raw = req.cookies[APP_SESSION_COOKIE] as string | undefined;
  if (!raw) return null;
  const [body, signature] = raw.split('.');
  if (!body || !signature) return null;
  try {
    // Verify the signature before trusting the payload; reject if tampered.
    const valid = await crypto.subtle.verify(
      'HMAC',
      await key(),
      Buffer.from(signature, 'base64url'),
      enc.encode(body)
    );
    return valid ? (JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

async function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = await getAppSession(req);
  if (!session) {
    res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  (req as any).appUser = session;
  next();
}

// Routes
// The login page (email form) is served at both `/` and `/login`. Logout
// returns users to `/login`, which is registered in Auth0's Allowed Logout URLs.
async function renderLogin(req: Request, res: Response) {
  const session = await getAppSession(req);
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
app.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = String((req.body as { email?: string }).email ?? '');
    const returnTo = safePath((req.body as { returnTo?: string }).returnTo);

    if (!email) {
      res.redirect('/login?error=missing_email');
      return;
    }

    const redirected = await startEnterpriseLogin(req, res, { email, returnTo });
    if (!redirected) {
      res.redirect(`/login?error=not_federated&returnTo=${encodeURIComponent(returnTo)}`);
    }
  } catch (err) {
    next(err);
  }
});

app.get('/public', async (req: Request, res: Response) => {
  const session = await getAppSession(req);
  res.render('public', { isLoggedIn: !!session, user: session, layout: 'layout' });
});

app.get('/private', requireSession, (req: Request, res: Response) => {
  res.render('private', { isLoggedIn: true, user: (req as any).appUser, layout: 'layout' });
});

// Clear our session, then federated-logout to end the upstream enterprise IdP
// session. We build the logout URL ourselves (instead of forwarding to the
// SDK's /auth/logout) so we can return the user to /login — the URL registered
// in Auth0's Allowed Logout URLs.
app.get('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.clearCookie(APP_SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    const logoutUrl = await req.auth0.client.logout({
      returnTo: `${APP_BASE_URL}/login`,
      federated: true,
    });

    res.redirect(logoutUrl.href);
  } catch (err) {
    next(err);
  }
});

app.listen(3000, () => console.log('Server listening on http://localhost:3000'));
