import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig } from './config.js';

describe('getConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear all relevant environment variables before each test
    process.env = { ...originalEnv };
    delete process.env.AUTH0_DOMAIN;
    delete process.env.ISSUER_BASE_URL;
    delete process.env.AUTH0_AUDIENCE;
    delete process.env.AUDIENCE;
    delete process.env.AUTH0_CLIENT_ID;
    delete process.env.AUTH0_CLIENT_SECRET;
    delete process.env.AUTH0_CLIENT_ASSERTION_SIGNING_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use explicit config when provided', () => {
    const config = getConfig({
      domain: 'test.auth0.com',
      audience: 'https://api.example.com',
    });

    expect(config.domain).toBe('test.auth0.com');
    expect(config.audience).toBe('https://api.example.com');
  });

  it('should load domain from AUTH0_DOMAIN env var', () => {
    process.env.AUTH0_DOMAIN = 'env.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';

    const config = getConfig();

    expect(config.domain).toBe('env.auth0.com');
  });

  it('should load domain from ISSUER_BASE_URL env var (legacy)', () => {
    process.env.ISSUER_BASE_URL = 'https://env.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';

    const config = getConfig();

    expect(config.domain).toBe('env.auth0.com');
  });

  it('should strip protocol from ISSUER_BASE_URL', () => {
    process.env.ISSUER_BASE_URL = 'https://env.auth0.com';
    process.env.AUDIENCE = 'https://api.example.com';

    const config = getConfig();

    expect(config.domain).toBe('env.auth0.com');
  });

  it('should load audience from AUTH0_AUDIENCE env var', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';

    const config = getConfig();

    expect(config.audience).toBe('https://api.example.com');
  });

  it('should load audience from AUDIENCE env var (legacy)', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUDIENCE = 'https://api.example.com';

    const config = getConfig();

    expect(config.audience).toBe('https://api.example.com');
  });

  it('should prefer AUTH0_DOMAIN over ISSUER_BASE_URL', () => {
    process.env.AUTH0_DOMAIN = 'preferred.auth0.com';
    process.env.ISSUER_BASE_URL = 'https://fallback.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';

    const config = getConfig();

    expect(config.domain).toBe('preferred.auth0.com');
  });

  it('should prefer AUTH0_AUDIENCE over AUDIENCE', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://preferred.example.com';
    process.env.AUDIENCE = 'https://fallback.example.com';

    const config = getConfig();

    expect(config.audience).toBe('https://preferred.example.com');
  });

  it('should prefer explicit config over environment variables', () => {
    process.env.AUTH0_DOMAIN = 'env.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://env.example.com';

    const config = getConfig({
      domain: 'explicit.auth0.com',
      audience: 'https://explicit.example.com',
    });

    expect(config.domain).toBe('explicit.auth0.com');
    expect(config.audience).toBe('https://explicit.example.com');
  });

  it('should load optional clientId from AUTH0_CLIENT_ID', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';
    process.env.AUTH0_CLIENT_ID = 'test_client_id';

    const config = getConfig();

    expect(config.clientId).toBe('test_client_id');
  });

  it('should load optional clientSecret from AUTH0_CLIENT_SECRET', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';
    process.env.AUTH0_CLIENT_SECRET = 'test_secret';

    const config = getConfig();

    expect(config.clientSecret).toBe('test_secret');
  });

  it('should throw error if domain is missing', () => {
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';

    expect(() => getConfig()).toThrow(
      "'domain' is required. Provide it via config or AUTH0_DOMAIN environment variable."
    );
  });

  it('should throw error if audience is missing', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';

    expect(() => getConfig()).toThrow(
      "'audience' is required. Provide it via config or AUTH0_AUDIENCE environment variable."
    );
  });

  it('should merge explicit config with environment variables', () => {
    process.env.AUTH0_DOMAIN = 'env.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://env.example.com';
    process.env.AUTH0_CLIENT_ID = 'env_client_id';

    const config = getConfig({
      audience: 'https://explicit.example.com', // override audience
      clientSecret: 'explicit_secret', // add clientSecret
    });

    expect(config.domain).toBe('env.auth0.com'); // from env
    expect(config.audience).toBe('https://explicit.example.com'); // explicit
    expect(config.clientId).toBe('env_client_id'); // from env
    expect(config.clientSecret).toBe('explicit_secret'); // explicit
  });

  it('should preserve customFetch when provided', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';

    const customFetch = async () => new Response();
    const config = getConfig({ customFetch });

    expect(config.customFetch).toBe(customFetch);
  });

  it('should preserve clientAssertionSigningKey when provided', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';

    const signingKey = 'test_key';
    const config = getConfig({ clientAssertionSigningKey: signingKey });

    expect(config.clientAssertionSigningKey).toBe(signingKey);
  });

  it('should preserve clientAssertionSigningAlg when provided', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';

    const config = getConfig({ clientAssertionSigningAlg: 'RS384' });

    expect(config.clientAssertionSigningAlg).toBe('RS384');
  });

  it('should load clientAssertionSigningKey from AUTH0_CLIENT_ASSERTION_SIGNING_KEY', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';
    process.env.AUTH0_CLIENT_ASSERTION_SIGNING_KEY = '-----BEGIN PRIVATE KEY-----\ntest_key\n-----END PRIVATE KEY-----';

    const config = getConfig();

    expect(config.clientAssertionSigningKey).toBe('-----BEGIN PRIVATE KEY-----\ntest_key\n-----END PRIVATE KEY-----');
  });

  it('should prefer explicit clientAssertionSigningKey over environment variable', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';
    process.env.AUTH0_CLIENT_ASSERTION_SIGNING_KEY = '-----BEGIN PRIVATE KEY-----\nenv_key\n-----END PRIVATE KEY-----';

    const config = getConfig({
      clientAssertionSigningKey: '-----BEGIN PRIVATE KEY-----\nexplicit_key\n-----END PRIVATE KEY-----',
    });

    expect(config.clientAssertionSigningKey).toBe('-----BEGIN PRIVATE KEY-----\nexplicit_key\n-----END PRIVATE KEY-----');
  });

  it('should work with both clientAssertionSigningKey and clientAssertionSigningAlg', () => {
    process.env.AUTH0_DOMAIN = 'test.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://api.example.com';
    process.env.AUTH0_CLIENT_ASSERTION_SIGNING_KEY = '-----BEGIN PRIVATE KEY-----\ntest_key\n-----END PRIVATE KEY-----';

    const config = getConfig({
      clientAssertionSigningAlg: 'RS256',
    });

    expect(config.clientAssertionSigningKey).toBe('-----BEGIN PRIVATE KEY-----\ntest_key\n-----END PRIVATE KEY-----');
    expect(config.clientAssertionSigningAlg).toBe('RS256');
  });
});
