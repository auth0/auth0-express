import { describe, expect, test } from 'vitest';
import { InvalidConfigurationError } from './index.js';

describe('InvalidConfigurationError', () => {
  test('has name and code, and uses provided message', () => {
    const err = new InvalidConfigurationError('bad config');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InvalidConfigurationError');
    expect(err.code).toBe('invalid_configuration_error');
    expect(err.message).toBe('bad config');
  });

  test('falls back to a default message', () => {
    const err = new InvalidConfigurationError();
    expect(err.message).toBe('The configuration is invalid.');
  });
});
