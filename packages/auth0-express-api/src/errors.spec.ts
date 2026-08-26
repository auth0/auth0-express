import { describe, it, expect } from 'vitest';
import { MissingClientAuthError, isConnectionExchangeError } from './index.js';

// The matching case is covered end to end in `index.spec.ts`, against the error
// api-js actually throws. These pin what must not match.
describe('isConnectionExchangeError', () => {
  it('should match a Token Vault exchange failure', () => {
    const error = Object.assign(new Error('Client credentials are required'), {
      code: 'token_for_connection_error',
    });

    expect(isConnectionExchangeError(error)).toBe(true);
  });

  it('should not match the error a half-configured client throws', () => {
    // `MissingClientAuthError` is a different failure with a different remedy,
    // and it can be caught by class, so the guard has to leave it alone.
    expect(isConnectionExchangeError(new MissingClientAuthError())).toBe(false);
  });

  it('should not match another error carrying a different code', () => {
    const error = Object.assign(new Error('rejected'), { code: 'token_exchange_error' });

    expect(isConnectionExchangeError(error)).toBe(false);
  });

  it('should not match an error with no code', () => {
    expect(isConnectionExchangeError(new Error('token_for_connection_error'))).toBe(false);
  });

  it('should not match a plain object wearing the right code', () => {
    // Narrowing promises an `Error`, so `message` and `stack` have to be real.
    expect(isConnectionExchangeError({ code: 'token_for_connection_error' })).toBe(false);
  });

  it('should not match values that are not errors at all', () => {
    for (const value of [undefined, null, '', 'token_for_connection_error', 0, [], () => {}]) {
      expect(isConnectionExchangeError(value)).toBe(false);
    }
  });
});
