import { describe, it, expect } from 'vitest';
import * as sdk from './index.js';
import { getCurrentActor, getDelegationChain, InvalidRequestError } from './index.js';
import type { Token } from './index.js';

describe('public exports', () => {
  // Values only, since type-only exports leave nothing at runtime.
  it('should export exactly the documented value surface', () => {
    expect(Object.keys(sdk).sort()).toEqual([
      'AuthError',
      'InvalidRequestError',
      'MissingClientAuthError',
      'TokenExchangeError',
      'VerifyAccessTokenError',
      'claimCheck',
      'claimEquals',
      'claimIncludes',
      'createAuth0Api',
      'getCurrentActor',
      'getDelegationChain',
      'requiresAuth',
      'scopesInclude',
    ]);
  });

  it('should not export the ApiClient class, only its type', () => {
    expect('ApiClient' in sdk).toBe(false);
  });

  it('should not export the pre-verification token extractor', () => {
    // Superseded by `req.auth0.token`, which is only set after verification.
    expect('getToken' in sdk).toBe(false);
  });

  it('should not export unsupported feature surfaces', () => {
    for (const name of [
      'ProtectedResourceMetadata',
      'ProtectedResourceMetadataBuilder',
      'BearerMethod',
      'SigningAlgorithm',
      'GrantType',
      'InvalidDpopProofError',
      'MissingTransactionError',
      'MissingRequiredArgumentError',
    ]) {
      expect(name in sdk).toBe(false);
    }
  });

  it('should not export the error Token Vault throws', () => {
    // `getAccessTokenForConnection()` throws `TokenForConnectionError`, but
    // api-js does not export it, so it cannot be re-exported here. Consumers
    // check `error.code === 'token_for_connection_error'` instead. If api-js
    // starts exporting it, add it above and update EXAMPLES.md.
    expect('TokenForConnectionError' in sdk).toBe(false);
  });
});

describe('act claim helpers', () => {
  // `req.auth0.user` is a `Token`. These pass one straight through, which is
  // only possible because `Token` declares `act`.
  const delegated: Token = {
    sub: 'user_123',
    aud: 'urn:api',
    iss: 'https://auth0.local/',
    act: { sub: 'service-b', act: { sub: 'service-a' } },
  };

  const direct: Token = {
    sub: 'user_123',
    aud: 'urn:api',
    iss: 'https://auth0.local/',
  };

  it('should return the outermost actor', () => {
    expect(getCurrentActor(delegated)).toBe('service-b');
  });

  it('should return undefined for a token that was not exchanged', () => {
    expect(getCurrentActor(direct)).toBeUndefined();
  });

  it('should return the delegation chain from newest to oldest', () => {
    expect(getDelegationChain(delegated)).toEqual(['service-b', 'service-a']);
  });

  it('should return an empty chain for a token that was not exchanged', () => {
    expect(getDelegationChain(direct)).toEqual([]);
  });

  it('should throw the re-exported InvalidRequestError on a malformed act claim', () => {
    // Also proves the re-exported class is the same one the helpers throw, which
    // would not hold if two copies of @auth0/auth0-api-js were resolved.
    const malformed = { ...direct, act: { sub: '' } } as Token;

    expect(() => getCurrentActor(malformed)).toThrow(InvalidRequestError);
    expect(() => getCurrentActor(malformed)).toThrow('Invalid "act" claim');
    expect(() => getDelegationChain(malformed)).toThrow(InvalidRequestError);
  });
});
