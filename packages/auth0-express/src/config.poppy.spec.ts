import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { getConfig } from './config.js';
import { InvalidConfigurationError } from './errors/index.js';
import { poppyConfig } from './test-utils/poppy.js';

describe('getConfig with poppy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  const baseEnv = () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    delete process.env.APP_BASE_URL;
    delete process.env.BASE_URL;
  };

  describe('secure cookie enforcement in production dynamic mode', () => {
    test('throws when poppy.cookie.secure is explicitly false', () => {
      baseEnv();
      process.env.NODE_ENV = 'production';

      let thrown: unknown;
      try {
        getConfig({ poppy: { config: poppyConfig, cookie: { secure: false } } });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(InvalidConfigurationError);
      expect((thrown as Error).message).toBe(
        'Secure cookies are required when relying on dynamic base URLs in production. ' +
          'Remove the explicit `poppy.cookie.secure = false` or set a static APP_BASE_URL.'
      );
    });

    test('forces poppy.cookie.secure to true, without changing the input', () => {
      baseEnv();
      process.env.NODE_ENV = 'production';
      const input = { poppy: { config: poppyConfig, cookie: { sameSite: 'none' as const } } };

      const config = getConfig(input);

      expect(config.poppy).toEqual({ config: poppyConfig, cookie: { sameSite: 'none', secure: true } });
      expect(input.poppy.cookie).toEqual({ sameSite: 'none' });
      expect('secure' in input.poppy.cookie).toBe(false);
    });

    test('adds poppy.cookie with secure: true when there is no cookie option, without changing the input', () => {
      baseEnv();
      process.env.NODE_ENV = 'production';
      const input = { poppy: { config: poppyConfig } };

      const config = getConfig(input);

      expect(config.poppy).toEqual({ config: poppyConfig, cookie: { secure: true } });
      expect('cookie' in input.poppy).toBe(false);
    });

    test('leaves poppy: true as it is', () => {
      baseEnv();
      process.env.NODE_ENV = 'production';

      expect(getConfig({ poppy: true }).poppy).toBe(true);
    });

    test('keeps secure: false when a static appBaseUrl is configured', () => {
      baseEnv();
      process.env.NODE_ENV = 'production';

      const config = getConfig({
        appBaseUrl: 'http://localhost:3000',
        poppy: { config: poppyConfig, cookie: { secure: false } },
      });

      expect(config.poppy).toEqual({ config: poppyConfig, cookie: { secure: false } });
    });

    test('keeps secure: false outside production', () => {
      baseEnv();
      process.env.NODE_ENV = 'development';

      const config = getConfig({ poppy: { config: poppyConfig, cookie: { secure: false } } });

      expect(config.poppy).toEqual({ config: poppyConfig, cookie: { secure: false } });
    });
  });

  describe('the poppy option', () => {
    test('is passed on as it is', () => {
      baseEnv();

      expect(getConfig({ poppy: { config: poppyConfig } }).poppy).toEqual({ config: poppyConfig });
    });

    test('is undefined when it is not set', () => {
      baseEnv();

      expect(getConfig({}).poppy).toBeUndefined();
    });
  });
});
