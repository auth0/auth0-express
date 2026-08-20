import express, { Request, Response } from 'express';
import {
  createAuth0Api,
  isConnectionExchangeError,
  MissingClientAuthError,
  requiresAuth,
  TokenExchangeError,
} from '@auth0/auth0-express-api';
import 'dotenv/config';

const app = express();

app.use(express.json());

// Mount Auth0 API router.
// The client credentials are only needed by the three exchange routes below.
// Leave them unset and the rest of the example still works.
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

// The connection whose provider token this example asks Token Vault for.
const connection = process.env.AUTH0_CONNECTION;

// Protected route that exchanges the caller's token for an access token issued
// by a third party the user has connected, such as Google.
app.get('/api/connection-token', requiresAuth(), async (req: Request, res: Response) => {
  if (!connection) {
    res.status(501).json({ error: 'AUTH0_CONNECTION is not set' });
    return;
  }

  try {
    const tokenSet = await req.auth0.client.getAccessTokenForConnection({
      connection,
      accessToken: req.auth0.token!,
    });

    // In a real API you would now call the provider with this token. It is the
    // provider's token, so it never goes back to the browser.
    res.json({
      sub: req.auth0.user!.sub,
      connection: tokenSet.connection,
      expiresAt: tokenSet.expiresAt,
      scope: tokenSet.scope,
    });
  } catch (error) {
    // AUTH0_CLIENT_ID set and AUTH0_CLIENT_SECRET not. Same as the route above,
    // and the only failure here that is not a `token_for_connection_error`.
    if (error instanceof MissingClientAuthError) {
      console.error(error.code, error.message);
      res.status(500).json({ error: 'client_not_configured' });
      return;
    }

    // The exchange itself failed. The SDK ships this guard because the class it
    // narrows to, `TokenForConnectionError`, is not exported by
    // @auth0/auth0-api-js, so there is nothing to catch by class.
    if (!isConnectionExchangeError(error)) {
      console.error(error);
      res.status(502).json({ error: 'connection_exchange_failed' });
      return;
    }

    console.error(error.code, error.cause?.error_description ?? error.message);

    // No `cause` means the SDK never reached the tenant. `requiresAuth()`
    // guarantees a subject token here, so no credentials at all were configured.
    if (!error.cause) {
      res.status(500).json({ error: 'client_not_configured' });
      return;
    }

    // The user has not linked this connection, the scopes were not granted, or
    // the connection is not set up in Token Vault.
    res.status(502).json({ error: 'connection_exchange_failed' });
  }
});

// The token type this example's Token Exchange Profile is configured to accept.
const subjectTokenType = process.env.AUTH0_SUBJECT_TOKEN_TYPE;

// Public route that turns a token Auth0 did not issue into one it did. There is
// no `requiresAuth()` here on purpose: the caller has no Auth0 token yet, which
// is the whole point. The Token Exchange Profile validates the incoming token
// at the tenant, so a token it does not recognise is rejected there.
app.post('/api/token-exchange', async (req: Request, res: Response) => {
  if (!subjectTokenType || !downstreamAudience) {
    res.status(501).json({ error: 'AUTH0_SUBJECT_TOKEN_TYPE or AUTH0_DOWNSTREAM_AUDIENCE is not set' });
    return;
  }

  const externalToken = req.body?.token;

  if (typeof externalToken !== 'string' || !externalToken) {
    res.status(400).json({ error: 'token is required' });
    return;
  }

  try {
    const tokenSet = await req.auth0.client.getTokenByExchangeProfile(externalToken, {
      subjectTokenType,
      audience: downstreamAudience,
    });

    res.json({
      accessToken: tokenSet.accessToken,
      expiresAt: tokenSet.expiresAt,
      scope: tokenSet.scope,
    });
  } catch (error) {
    // Same two cases as /api/on-behalf-of, since this method reports a missing
    // credential the ordinary way.
    if (error instanceof MissingClientAuthError) {
      console.error(error.code, error.message);
      res.status(500).json({ error: 'client_not_configured' });
      return;
    }

    // No profile matches the subject token type, or the profile's action
    // rejected the token. Either way the wording stays in the logs: this route
    // is reachable by whoever holds the external token.
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
