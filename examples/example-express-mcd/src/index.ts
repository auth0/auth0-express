import express, { Request, Response, NextFunction } from 'express';
import { createAuth0, DomainResolver, StoreOptions } from '@auth0/auth0-express';
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
// shared nav plus the host / resolved-Auth0-domain banner.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);

// Multiple Custom Domains (MCD) configuration.
//
// This single app serves two hostnames — tenant-1.localhost and
// tenant-2.localhost — on the same port, each mapped to a different Auth0
// custom domain of the SAME Auth0 tenant. The mapping is driven by env vars so
// you can point it at your own custom domains.
const defaultAuth0Domain = process.env.AUTH0_DOMAIN as string;
const domainsByHost: Record<string, string> = {
  'tenant-1.localhost:3000': process.env.AUTH0_CUSTOM_DOMAIN_1 as string,
  'tenant-2.localhost:3000': process.env.AUTH0_CUSTOM_DOMAIN_2 as string,
};

// Resolve the Auth0 custom domain for a given request host, falling back to the
// default domain when the host is not in the map.
//
// SECURITY: you are responsible for ensuring every resolved domain is a trusted
// custom domain of your Auth0 tenant. A resolver that returns an
// attacker-controlled value is a critical risk (auth bypass / SSRF). When
// inferring the host from request headers, run behind a trusted reverse proxy
// that sanitizes `Host` / `X-Forwarded-Host` before they reach the app.
function resolveAuth0Domain(host: string | undefined): string {
  return (host && domainsByHost[host]) || defaultAuth0Domain;
}

// A `DomainResolver` is called per request and receives the Express request
// context. Passing it to `domain` (instead of a static string) enables MCD.
const domainResolver: DomainResolver<StoreOptions> = (context) =>
  resolveAuth0Domain(context?.request.headers.host);

// Mount Auth0 router.
//
// Only the MCD-specific options are passed here; the rest of the configuration
// (clientId, clientSecret, sessionSecret, and the APP_BASE_URL allow-list) is
// read from the environment by the SDK. `APP_BASE_URL` is a comma-separated
// list, which the SDK matches against each request to resolve the correct base
// URL — so callbacks, redirects, and logout use the right origin for each host.
app.use(
  createAuth0({
    domain: domainResolver,
    // Discovery (OIDC metadata + JWKS) is cached per resolved domain. Raise
    // `maxEntries` when a single process serves more than ~100 distinct Auth0
    // domains within the TTL window, which is common in larger MCD fleets.
    discoveryCache: { ttl: 600, maxEntries: 100 },
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

  res.render('index', {
    isLoggedIn: !!user,
    user,
    host: req.headers.host,
    auth0Domain: resolveAuth0Domain(req.headers.host),
    layout: 'layout',
  });
});

app.get('/public', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('public', {
    isLoggedIn: !!user,
    user,
    host: req.headers.host,
    auth0Domain: resolveAuth0Domain(req.headers.host),
    layout: 'layout',
  });
});

app.get('/private', requireSession, async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('private', {
    isLoggedIn: !!user,
    user,
    host: req.headers.host,
    auth0Domain: resolveAuth0Domain(req.headers.host),
    layout: 'layout',
  });
});

const start = async () => {
  try {
    app.listen(3000, () => {
      console.log('Server listening on http://tenant-1.localhost:3000 and http://tenant-2.localhost:3000');
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
