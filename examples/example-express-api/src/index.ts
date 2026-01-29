import express, { Request, Response } from 'express';
import { createAuth0ApiRouter, requireAuth } from '@auth0/auth0-express-api';
import 'dotenv/config';

const app = express();

app.use(express.json());

// Mount Auth0 API router
const auth0Router = createAuth0ApiRouter({
  domain: process.env.AUTH0_DOMAIN as string,
  audience: process.env.AUTH0_AUDIENCE as string,
});

app.use(auth0Router);

// Protected route requiring authentication
app.get('/api/private', requireAuth(), async (req: Request, res: Response) => {
  res.send(`Hello, ${req.auth0.user?.sub}`);
});

// Protected route requiring specific scope
app.get('/api/private-scope', requireAuth({ scopes: ['read:private'] }), async (req: Request, res: Response) => {
  res.send(`Hello, ${req.auth0.user?.sub}`);
});

// Public route (no authentication required)
app.get('/api/public', async (req: Request, res: Response) => {
  res.send('Hello world!');
});

const start = async () => {
  try {
    app.listen(3000, () => {
      console.log('API server listening on http://localhost:3000');
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
