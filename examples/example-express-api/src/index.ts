import express, { Request, Response } from 'express';
import { createAuth0Api, MissingClientAuthError, requiresAuth, TokenExchangeError } from '@auth0/auth0-express-api';
import 'dotenv/config';

const app = express();

app.use(express.json());

// Mount Auth0 API router.
// The client credentials are only needed by /api/on-behalf-of below. Leave them
// unset and the rest of the example still works.
const auth0Router = createAuth0Api({
  domain: process.env.AUTH0_DOMAIN as string,
  audience: process.env.AUTH0_AUDIENCE as string,
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
});

app.use(auth0Router);

// Protected route requiring authentication
app.get('/api/private', requiresAuth(), async (req: Request, res: Response) => {
  res.send(`Hello, ${req.auth0.user!.sub}`);
});

// Protected route requiring specific scope
app.get('/api/private-scope', requiresAuth({ scopes: ['read:private'] }), async (req: Request, res: Response) => {
  res.send(`Hello, ${req.auth0.user!.sub}`);
});

// Only this route needs a downstream API to call. Read once so the route can
// say what is missing instead of sending an undefined audience to the tenant.
const downstreamAudience = process.env.AUTH0_DOWNSTREAM_AUDIENCE;

// Protected route that exchanges the caller's token for one issued to a
// downstream API, still on behalf of the same user.
app.get('/api/on-behalf-of', requiresAuth(), async (req: Request, res: Response) => {
  if (!downstreamAudience) {
    res.status(501).json({ error: 'AUTH0_DOWNSTREAM_AUDIENCE is not set' });
    return;
  }

  try {
    // `requiresAuth()` verified the token, so `req.auth0.token` is the raw token
    // to exchange. Passing it is the route's job.
    const tokenSet = await req.auth0.client.getTokenOnBehalfOf(req.auth0.token!, {
      audience: downstreamAudience,
    });

    // In a real API you would now call the downstream service with this token:
    //   fetch(url, { headers: { authorization: `Bearer ${tokenSet.accessToken}` } })
    res.json({
      sub: req.auth0.user!.sub,
      downstreamAudience,
      expiresAt: tokenSet.expiresAt,
      scope: tokenSet.scope,
    });
  } catch (error) {
    // A client that cannot authenticate is this server's own misconfiguration,
    // reached before any request to the tenant, so it is not a `502`. Most often
    // AUTH0_CLIENT_ID is set and AUTH0_CLIENT_SECRET is not.
    if (error instanceof MissingClientAuthError) {
      console.error(error.code, error.message);
      res.status(500).json({ error: 'client_not_configured' });
      return;
    }

    // Usually a missing grant or a client that is not allowed to exchange. The
    // tenant's wording belongs in your logs, not in the response.
    if (error instanceof TokenExchangeError) {
      console.error(error.code, error.cause?.error_description);
    } else {
      console.error(error);
    }

    res.status(502).json({ error: 'exchange_failed' });
  }
});

// Public route (no authentication required)
app.get('/api/public', async (req: Request, res: Response) => {
  res.send('Hello world!');
});

const start = async () => {
  try {
    // Defaults to 3000; set PORT to run on another port (e.g. 3001 when running
    // alongside the example-express-web-call-api web app).
    const port = Number(process.env.PORT ?? 3000);
    app.listen(port, () => {
      console.log(`API server listening on http://localhost:${port}`);
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
