import express, { Request, Response } from 'express';
import { createAuth0, requiresAuth } from '@auth0/auth0-express';
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

// Mount Auth0 router
// The SDK can automatically read configuration from environment variables
// when using getConfig() or by passing an empty object to createAuth0().
// For explicit control, we're passing the values directly here.
app.use(
  createAuth0({
    domain: process.env.AUTH0_DOMAIN as string,
    clientId: process.env.AUTH0_CLIENT_ID as string,
    clientSecret: process.env.AUTH0_CLIENT_SECRET as string,
    appBaseUrl: process.env.APP_BASE_URL as string,
    sessionSecret: process.env.AUTH0_SESSION_SECRET as string,
  })
);

// Routes
app.get('/', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('index', { isLoggedIn: !!user, user: user, layout: 'layout' });
});

app.get('/public', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('public', {
    isLoggedIn: !!user,
    user,
    layout: 'layout',
  });
});

app.get('/private', requiresAuth(), async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('private', {
    isLoggedIn: !!user,
    user,
    layout: 'layout',
  });
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
