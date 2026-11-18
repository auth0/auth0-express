import 'dotenv/config';
import type { Express } from 'express';
import { createApp } from './app.js';

// Defaults to 3000; set PORT to run on another port.
const port = Number(process.env.PORT ?? 3000);

// The SDK reads these from the environment. Say which one is missing, in terms of `.env`.
const missing = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH0_SESSION_SECRET', 'APP_BASE_URL'].filter(
  (name) => !process.env[name]
);
if (missing.length > 0) {
  console.error(`Cannot start the shop. Missing in .env: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

let app: Express;
try {
  app = createApp();
} catch (error) {
  // Most often there is no `poppy.json` in this folder. The message of the SDK says what is wrong.
  console.error(`Cannot start the shop: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Run `auth0 poppy config` in this folder to write poppy.json. See "Run it for real" in the README.');
  process.exit(1);
}

app.listen(port, (error?: Error) => {
  // Express 5 passes a listen error, such as a port that is in use, to this callback.
  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`Shop listening on http://localhost:${port}`);
  console.log(`Agents use the public https address in APP_BASE_URL: ${process.env.APP_BASE_URL}`);
});
