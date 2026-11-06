import 'dotenv/config';
import { createApp } from './app.js';

// Defaults to 3000; set PORT to run on another port.
const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, (error?: Error) => {
  // Express 5 passes a listen error, such as a port that is in use, to this callback.
  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`Shop API listening on http://localhost:${port}`);
});
