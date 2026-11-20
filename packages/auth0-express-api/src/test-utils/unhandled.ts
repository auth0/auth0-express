import type { UnhandledRequestCallback } from 'msw';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * `onUnhandledRequest` for an msw server in a test that runs an app of its own. A request to this machine goes through,
 * because supertest talks to the app on 127.0.0.1. Any other request that no handler covers is recorded in `unhandled`
 * and answered by msw with an error, so that it never reaches the network. Check `unhandled` in `afterEach`: a test that
 * catches the error would otherwise pass.
 *
 * `print.error()` alone is not enough: with a callback it only prints, and the request goes on to the real host.
 */
export function failOnExternalRequests(unhandled: string[]): UnhandledRequestCallback {
  return (request, print) => {
    if (LOOPBACK_HOSTS.includes(new URL(request.url).hostname)) {
      return;
    }

    unhandled.push(`${request.method} ${request.url}`);
    print.error();
    throw new Error(`A request has no handler: ${request.method} ${request.url}`);
  };
}
