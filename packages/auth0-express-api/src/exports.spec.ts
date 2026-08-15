import { describe, it, expect } from 'vitest';
import * as sdk from './index.js';
import { getCurrentActor, getDelegationChain, InvalidRequestError } from './index.js';
import type { Token } from './index.js';

describe('public exports', () => {
  // Type-only exports disappear at runtime, so this covers values only. It is
  // here to make a dropped or renamed export a failing test rather than a
  // silent break for consumers.
  it('should export exactly the documented value surface', () => {
    expect(Object.keys(sdk).sort()).toEqual([
      'ApiClient',
      'AuthError',
      'InvalidConfigurationError',
      'InvalidRequestError',
      'MissingClientAuthError',
      'MissingRequiredArgumentError',
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

  it('should not export the pre-verification token extractor', () => {
    // `req.auth0.token` is the supported way to reach the raw token, and unlike
    // `getToken()` it is only set on a request this API has already verified.
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
    ]) {
      expect(name in sdk).toBe(false);
    }
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
