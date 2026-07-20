/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { StatelessStateStore } from '@auth0/auth0-server-js';
import type { StateData } from '@auth0/auth0-server-js';
import { createServerClientInstance } from './utils.js';
import { runWithContext } from './store/request-context.js';

const OLD_SECRET = 'old-session-secret-at-least-32-characters';
const NEW_SECRET = 'new-session-secret-at-least-32-characters';
const cookieName = 'appSession';

const sampleState: StateData = {
  user: { sub: 'auth0|rotation' },
  idToken: undefined,
  refreshToken: 'refresh',
  tokenSets: [],
  internal: { sid: 'sid-rotation', createdAt: Math.floor(Date.now() / 1000) },
};

/**
 * Encrypts a stateless session cookie under a given secret, exactly as the SDK's own
 * StatelessStateStore would, so we can feed a pre-rotation cookie back into a rotated client.
 */
async function encryptSessionCookie(secret: string): Promise<string> {
  const captured: Record<string, string> = {};
  const handler = {
    setCookie: (name: string, value: string) => {
      captured[name] = value;
    },
    getCookie: (name: string) => captured[name],
    getCookies: () => captured,
    deleteCookie: vi.fn(),
  };
  const store = new StatelessStateStore({ secret, cookie: { name: cookieName } } as any, handler as any);
  const response = { cookie: vi.fn(), clearCookie: vi.fn() } as any;
  await runWithContext({ request: { cookies: {} } as any, response }, () =>
    store.set(cookieName, sampleState, false, { request: { cookies: {} } as any, response })
  );
  return Object.entries(captured)
    .filter(([name]) => name.startsWith(cookieName))
    .sort(([a], [b]) => parseInt(a.split('.')[1] ?? '0', 10) - parseInt(b.split('.')[1] ?? '0', 10))
    .map(([, value]) => value)
    .join('');
}

describe('session secret rotation (end-to-end via createServerClientInstance)', () => {
  it('reads a session cookie encrypted under the old secret after rotating to [new, old]', async () => {
    const cookieValue = await encryptSessionCookie(OLD_SECRET);

    const client = createServerClientInstance({
      domain: 'tenant.auth0.com',
      clientId: 'client_id',
      clientSecret: 'client_secret',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: [NEW_SECRET, OLD_SECRET],
      sessionConfiguration: { cookie: { name: cookieName } },
    });

    // Cookie-parser splits chunked cookies into `${name}.0`, `${name}.1`, ...; here the payload
    // fits one chunk, so present it under `${name}.0` like the real cookie handler reads it.
    const request = { cookies: { [`${cookieName}.0`]: cookieValue } } as any;
    const response = { cookie: vi.fn(), clearCookie: vi.fn() } as any;

    const user = await runWithContext({ request, response }, () => client.getUser({ request, response }));

    expect(user?.sub).toBe('auth0|rotation');
  });

  it('cannot read the old-secret cookie once the old secret is dropped (only [new])', async () => {
    const cookieValue = await encryptSessionCookie(OLD_SECRET);

    const client = createServerClientInstance({
      domain: 'tenant.auth0.com',
      clientId: 'client_id',
      clientSecret: 'client_secret',
      appBaseUrl: 'http://localhost:3000',
      sessionSecret: [NEW_SECRET],
      sessionConfiguration: { cookie: { name: cookieName } },
    });

    const request = { cookies: { [`${cookieName}.0`]: cookieValue } } as any;
    const response = { cookie: vi.fn(), clearCookie: vi.fn() } as any;

    const user = await runWithContext({ request, response }, () => client.getUser({ request, response }));

    expect(user).toBeUndefined();
  });
});
