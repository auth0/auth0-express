import express, { Request, Response } from 'express';
import { createAuth0Api, requiresAuth } from '@auth0/auth0-express-api';
import 'dotenv/config';

const app = express();

app.use(express.json());

// Mount Auth0 API router
const auth0Router = createAuth0Api({
  domain: process.env.AUTH0_DOMAIN as string,
  audience: process.env.AUTH0_AUDIENCE as string,
});

app.use(auth0Router);

// Protected route requiring authentication
app.get('/api/private', requiresAuth(), async (req: Request, res: Response) => {
  res.send(`Hello, ${req.auth0.user?.sub}`);
});

// Protected route requiring specific scope
app.get('/api/private-scope', requiresAuth({ scopes: ['read:private'] }), async (req: Request, res: Response) => {
  res.send(`Hello, ${req.auth0.user?.sub}`);
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
