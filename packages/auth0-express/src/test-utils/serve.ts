import { createServer } from 'node:http';
import type { Express } from 'express';
import request from 'supertest';
import { onTestFinished } from 'vitest';

/**
 * Starts `app` on a port of 127.0.0.1 and returns a supertest client for it. The server is closed when the current test
 * finishes, so call this from inside a test.
 *
 * supertest on its own listens on every address of the machine and then connects to 127.0.0.1. On macOS another program
 * that listens on 127.0.0.1 alone, on the same port, can then get the request in place of the app (the helper processes
 * of an editor do), and answer with a 404 or not at all. A server that listens on 127.0.0.1 itself cannot be taken over
 * like that.
 */
export async function serve(app: Express) {
  const started = createServer(app);
  await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));

  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        started.close(() => resolve());
        started.closeAllConnections();
      })
  );

  return request(started);
}
