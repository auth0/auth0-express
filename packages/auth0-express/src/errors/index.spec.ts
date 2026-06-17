import { describe, expect, test } from 'vitest';
import { InvalidConfigurationError } from '@auth0/auth0-server-js';
import { InvalidConfigurationError as LocalInvalidConfigurationError } from './index.js';

describe('InvalidConfigurationError', () => {
  test('re-exports InvalidConfigurationError from @auth0/auth0-server-js', () => {
    expect(LocalInvalidConfigurationError).toBe(InvalidConfigurationError);
  });

  test('has name, code, and uses provided message', () => {
    const err = new InvalidConfigurationError('bad config');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InvalidConfigurationError');
    expect(err.code).toBe('invalid_configuration_error');
    expect(err.message).toBe('bad config');
  });
});
