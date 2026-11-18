import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import { InvalidConfigurationError } from '@auth0/auth0-api-js';
import type { ApiClient } from '@auth0/auth0-api-js';
import { createAuth0Api } from './index.js';
import type { Auth0ApiOptions } from './index.js';
import { isPoppyClient } from './poppy/poppy-clients.js';
import { serve } from './test-utils/serve.js';

const domain = 'auth0.local';
const audience = 'https://api.example.com';
const publicOrigin = 'https://api.example.com';

function catchError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected the action to throw.');
}

// The client the router attaches, as a route handler sees it.
async function clientOf(options: Partial<Auth0ApiOptions>): Promise<ApiClient> {
  const router = createAuth0Api({ domain, audience, ...options });
  const seen: { client?: ApiClient } = {};

  router.get('/client', (req, res) => {
    seen.client = req.auth0.client;
    res.end();
  });
  const api = await serve(express().use(router));
  await api.get('/client').expect(200);

  if (!seen.client) {
    throw new Error('The route did not run.');
  }
  return seen.client;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAuth0Api with the poppy option', () => {
  it('should build a Poppy client when only the public origin is set', async () => {
    const client = await clientOf({ poppy: { publicOrigin } });

    expect(isPoppyClient(client)).toBe(true);
  });

  it.each([
    ['an empty poppy option', {}],
    ['verifySession alone', { verifySession: true }],
    ['agents alone', { agents: ['https://agent.example/agent.json'] }],
    ['a publicOrigin that is undefined', { publicOrigin: undefined }],
  ])('should fail startup for %s, as the public origin is required', (_name, poppy) => {
    const error = catchError(() => createAuth0Api({ domain, audience, poppy }));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(
      'Invalid poppy configuration: poppy.publicOrigin is required. Set it to the public origin of your API, such as https://api.example.com.'
    );
  });

  it('should build a Poppy client for the options a developer sets', async () => {
    const client = await clientOf({
      poppy: {
        verifySession: true,
        publicOrigin: 'https://api.example.com',
        agents: ['https://agent.example/agent.json'],
      },
    });

    expect(isPoppyClient(client)).toBe(true);
  });

  it('should hand the poppy options to ApiClient, whose own check then reaches the caller', () => {
    const error = catchError(() => createAuth0Api({ domain, audience, poppy: { publicOrigin, iatWindow: -1 } }));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toContain('"iatWindow" must be a non-negative number');
  });

  it('should fail startup for a publicOrigin that is not an origin', () => {
    const error = catchError(() =>
      createAuth0Api({ domain, audience, poppy: { publicOrigin: 'https://api.example.com/v1' } })
    );

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toContain('"publicOrigin"');
  });

  it('should leave the poppy object it was given as it was', async () => {
    const poppy = { verifySession: true, publicOrigin };

    await clientOf({ poppy });

    expect(poppy).toStrictEqual({ verifySession: true, publicOrigin });
  });

  it('should build a client that is not a Poppy client without the poppy option', async () => {
    const client = await clientOf({});

    expect(isPoppyClient(client)).toBe(false);
  });

  it('should mark only the client that was built with poppy', async () => {
    const withPoppy = await clientOf({ poppy: { publicOrigin } });
    const withoutPoppy = await clientOf({});

    expect(isPoppyClient(withPoppy)).toBe(true);
    expect(isPoppyClient(withoutPoppy)).toBe(false);
  });
});
