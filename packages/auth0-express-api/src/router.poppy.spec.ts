import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidConfigurationError } from '@auth0/auth0-api-js';
import type { ApiClient } from '@auth0/auth0-api-js';
import { createAuth0Api } from './index.js';
import type { Auth0ApiOptions } from './index.js';
import { isPoppyClient } from './poppy/poppy-clients.js';
import { cannotRead, catchError, cwdAt, notValidJson } from './test-utils/config-file.js';
import { serve } from './test-utils/serve.js';

const testUtilsDir = fileURLToPath(new URL('./test-utils', import.meta.url));
const poppyDir = join(testUtilsDir, 'poppy');

const domain = 'auth0.local';
const audience = 'https://api.example.com';

// What src/test-utils/poppy/auth0-poppy.json holds.
const fixtureConfig = {
  issuer: 'https://auth0.local/',
  apis: [{ identifier: audience, public_origin: 'https://api.example.com' }],
};

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
  it('should read auth0-poppy.json from process.cwd() and build a Poppy client', async () => {
    cwdAt(poppyDir);

    const client = await clientOf({ poppy: {} });

    expect(isPoppyClient(client)).toBe(true);
  });

  it('should fail startup with the read-failure text when process.cwd() has no auth0-poppy.json', () => {
    cwdAt(testUtilsDir);

    const error = catchError(() => createAuth0Api({ domain, audience, poppy: {} }));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(cannotRead(join(testUtilsDir, 'auth0-poppy.json')));
  });

  it('should fail startup with the not-valid-JSON text when the file is not JSON', () => {
    const notJsonDir = join(poppyDir, 'not-json');
    cwdAt(notJsonDir);

    const error = catchError(() => createAuth0Api({ domain, audience, poppy: {} }));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(notValidJson(join(notJsonDir, 'auth0-poppy.json')));
    expect(error.message).not.toContain('oops');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('should hand the parsed file to ApiClient, whose own check then reaches the caller', () => {
    const configPath = join(poppyDir, 'other-audience', 'auth0-poppy.json');

    const error = catchError(() => createAuth0Api({ domain, audience, poppy: { configPath } }));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toContain(`"config.apis" has no entry with the identifier "${audience}"`);
  });

  it('should read the file at a configPath given as a URL', async () => {
    const configPath = new URL('./test-utils/poppy/auth0-poppy.json', import.meta.url);

    const client = await clientOf({ poppy: { configPath } });

    expect(isPoppyClient(client)).toBe(true);
  });

  it('should hand the other poppy options to ApiClient', () => {
    const error = catchError(() =>
      createAuth0Api({ domain, audience, poppy: { config: fixtureConfig, iatWindow: -1 } })
    );

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toContain('"iatWindow" must be a non-negative number');
  });

  it('should read no file when config is given, whatever configPath says', async () => {
    const client = await clientOf({ poppy: { config: fixtureConfig, configPath: '/does/not/exist.json' } });

    expect(isPoppyClient(client)).toBe(true);
  });

  it('should leave the poppy object it was given as it was', async () => {
    cwdAt(poppyDir);
    const poppy = { verifySession: true };

    await clientOf({ poppy });

    expect(poppy).toStrictEqual({ verifySession: true });
  });

  it('should build a client that is not a Poppy client, and read no file, without the poppy option', async () => {
    cwdAt(testUtilsDir);

    const client = await clientOf({});

    expect(isPoppyClient(client)).toBe(false);
  });

  it('should mark only the client that was built with poppy', async () => {
    cwdAt(poppyDir);

    const withPoppy = await clientOf({ poppy: {} });
    const withoutPoppy = await clientOf({});

    expect(isPoppyClient(withPoppy)).toBe(true);
    expect(isPoppyClient(withoutPoppy)).toBe(false);
  });
});
