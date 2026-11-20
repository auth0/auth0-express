import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { failOnExternalRequests } from './unhandled.js';

describe('failOnExternalRequests', () => {
  const unhandled: string[] = [];
  const server = setupServer();

  beforeAll(() => server.listen({ onUnhandledRequest: failOnExternalRequests(unhandled) }));
  afterAll(() => server.close());

  test('stops a request to another host before it reaches the network, and records it', async () => {
    unhandled.length = 0;

    // msw answers an unhandled request with an error response or a network error. Either way, it is not a request that
    // reached the host, which does not exist: that would be a DNS error, which has `ENOTFOUND` in its cause.
    const outcome = await fetch('https://unmocked.example.com/path').then(
      (response) => ({ status: response.status }),
      (error: Error & { cause?: { code?: string } }) => ({ code: error.cause?.code })
    );

    expect(unhandled).toEqual(['GET https://unmocked.example.com/path']);
    expect(outcome).not.toEqual({ code: 'ENOTFOUND' });
    unhandled.length = 0;
  });

  test('lets a request to this machine go through, and does not record it', async () => {
    unhandled.length = 0;
    const app = createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = app.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/`);

      expect(await response.text()).toBe('ok');
      expect(unhandled).toEqual([]);
    } finally {
      app.closeAllConnections();
      app.close();
    }
  });
});
