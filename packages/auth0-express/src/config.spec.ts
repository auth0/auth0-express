import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { getConfig } from './config.js';
import { InvalidConfigurationError } from './errors/index.js';

describe('getConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  test('merges environment variables with provided config', () => {
    process.env.AUTH0_DOMAIN = 'env.auth0.com';
    process.env.AUTH0_CLIENT_ID = 'env_client_id';
    process.env.AUTH0_CLIENT_SECRET = 'env_client_secret';
    process.env.APP_BASE_URL = 'http://env.localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'env_secret';

    const config = getConfig();

    expect(config.domain).toBe('env.auth0.com');
    expect(config.clientId).toBe('env_client_id');
    expect(config.clientSecret).toBe('env_client_secret');
    expect(config.appBaseUrl).toBe('http://env.localhost:3000');
    expect(config.sessionSecret).toBe('env_secret');
  });

  test('explicit config overrides environment variables', () => {
    process.env.AUTH0_DOMAIN = 'env.auth0.com';
    process.env.AUTH0_CLIENT_ID = 'env_client_id';
    process.env.AUTH0_CLIENT_SECRET = 'env_client_secret';
    process.env.APP_BASE_URL = 'http://env.localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'env_secret';

    const config = getConfig({
      domain: 'config.auth0.com',
      clientId: 'config_client_id',
      clientSecret: 'config_client_secret',
      appBaseUrl: 'http://config.localhost:3000',
      sessionSecret: 'config_secret',
    });

    expect(config.domain).toBe('config.auth0.com');
    expect(config.clientId).toBe('config_client_id');
    expect(config.appBaseUrl).toBe('http://config.localhost:3000');
    expect(config.sessionSecret).toBe('config_secret');
  });

  test('supports ISSUER_BASE_URL as alternative to DOMAIN', () => {
    process.env.ISSUER_BASE_URL = 'https://issuer.auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'secret';

    const config = getConfig();

    expect(config.domain).toBe('issuer.auth0.com');
  });

  test('supports ISSUER_BASE_URL (without protocol) as alternative to DOMAIN', () => {
    process.env.ISSUER_BASE_URL = 'issuer.auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'secret';

    const config = getConfig();

    expect(config.domain).toBe('issuer.auth0.com');
  });

  test('DOMAIN takes precedence over ISSUER_BASE_URL', () => {
    process.env.AUTH0_DOMAIN = 'domain.auth0.com';
    process.env.ISSUER_BASE_URL = 'issuer.auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    const config = getConfig();

    expect(config.domain).toBe('domain.auth0.com');
  });

  test('supports APP_BASE_URL as alternative to BASE_URL', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:4000';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    delete process.env.BASE_URL; // Ensure BASE_URL is not set

    const config = getConfig();

    expect(config.appBaseUrl).toBe('http://localhost:4000');
  });

  test('APP_BASE_URL takes precedence over BASE_URL', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.BASE_URL = 'http://localhost:4000';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'secret';

    const config = getConfig();

    expect(config.appBaseUrl).toBe('http://localhost:3000');
  });

  test('supports SESSION_SECRET as alternative to SECRET', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'session_secret_value';

    const config = getConfig();

    expect(config.sessionSecret).toBe('session_secret_value');
  });

  test('AUTH0_SESSION_SECRET takes precedence over SECRET', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.SECRET = 'secret_value';
    process.env.AUTH0_SESSION_SECRET = 'session_secret_value';

    const config = getConfig();

    expect(config.sessionSecret).toBe('session_secret_value');
  });

  test('supports optional AUDIENCE environment variable', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';

    const config = getConfig();

    expect(config.audience).toBe('https://api.example.com');
  });

  test('throws error when domain is missing', () => {
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'secret';

    expect(() => getConfig()).toThrow(`The argument 'domain' is required but was not provided.`);
  });

  test('throws error when clientId is missing', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'secret';

    expect(() => getConfig()).toThrow(`The argument 'clientId' is required but was not provided.`);
  });

  test('does not throw when appBaseUrl is missing (dynamic mode)', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    delete process.env.BASE_URL;
    delete process.env.APP_BASE_URL;

    const config = getConfig();
    expect(config.appBaseUrl).toBeUndefined();
  });

  test('throws error when sessionSecret is missing', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:3000';

    expect(() => getConfig()).toThrow(`The argument 'sessionSecret' is required but was not provided.`);
  });

  test('allows partial config from env vars', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.APP_BASE_URL = 'http://localhost:3000';

    const config = getConfig({
      clientId: 'config_client_id',
      sessionSecret: 'config_secret',
    });

    expect(config.domain).toBe('auth0.com');
    expect(config.clientId).toBe('config_client_id');
    expect(config.appBaseUrl).toBe('http://localhost:3000');
    expect(config.sessionSecret).toBe('config_secret');
  });

  test('preserves additional config options not from env', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.AUTH0_SESSION_SECRET = 'secret';

    const config = getConfig({
      pushedAuthorizationRequests: true,
      routes: {
        login: '/custom-login',
      },
      hooks: {
        onLogin: async () => {
          console.log('logged in');
        },
      },
    });

    expect(config.pushedAuthorizationRequests).toBe(true);
    expect(config.routes?.login).toBe('/custom-login');
    expect(config.hooks?.onLogin).toBeDefined();
  });

  describe('appBaseUrl parsing and validation', () => {
    test('parses comma-separated APP_BASE_URL into an array', () => {
      process.env.AUTH0_DOMAIN = 'auth0.com';
      process.env.AUTH0_CLIENT_ID = 'client_id';
      process.env.AUTH0_SESSION_SECRET = 'secret';
      process.env.APP_BASE_URL = 'https://app1.example.com, https://app2.example.com';

      const config = getConfig();

      expect(config.appBaseUrl).toEqual(['https://app1.example.com', 'https://app2.example.com']);
    });

    test('keeps a single APP_BASE_URL as a string', () => {
      process.env.AUTH0_DOMAIN = 'auth0.com';
      process.env.AUTH0_CLIENT_ID = 'client_id';
      process.env.AUTH0_SESSION_SECRET = 'secret';
      process.env.APP_BASE_URL = 'https://app.example.com';

      const config = getConfig();

      expect(config.appBaseUrl).toBe('https://app.example.com');
    });

    test('allows appBaseUrl to be omitted (dynamic mode)', () => {
      process.env.AUTH0_DOMAIN = 'auth0.com';
      process.env.AUTH0_CLIENT_ID = 'client_id';
      process.env.AUTH0_SESSION_SECRET = 'secret';
      delete process.env.APP_BASE_URL;
      delete process.env.BASE_URL;

      const config = getConfig();

      expect(config.appBaseUrl).toBeUndefined();
    });

    test('throws when a static appBaseUrl is not a valid http(s) URL', () => {
      process.env.AUTH0_DOMAIN = 'auth0.com';
      process.env.AUTH0_CLIENT_ID = 'client_id';
      process.env.AUTH0_SESSION_SECRET = 'secret';

      expect(() => getConfig({ appBaseUrl: 'not-a-url' })).toThrowError(InvalidConfigurationError);
    });

    test('throws when appBaseUrl is an empty array', () => {
      process.env.AUTH0_DOMAIN = 'auth0.com';
      process.env.AUTH0_CLIENT_ID = 'client_id';
      process.env.AUTH0_SESSION_SECRET = 'secret';

      expect(() => getConfig({ appBaseUrl: [] })).toThrowError(
        /APP_BASE_URL array configuration cannot be empty/
      );
    });

    test('throws when an appBaseUrl array contains an invalid URL, naming the entry', () => {
      process.env.AUTH0_DOMAIN = 'auth0.com';
      process.env.AUTH0_CLIENT_ID = 'client_id';
      process.env.AUTH0_SESSION_SECRET = 'secret';

      expect(() =>
        getConfig({ appBaseUrl: ['https://valid.com', 'not-a-url'] })
      ).toThrowError(/not-a-url/);
    });
  });
});
