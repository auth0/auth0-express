import { describe, it, expect, expectTypeOf } from 'vitest';
import * as apiJs from '@auth0/auth0-api-js';
import * as sdk from './index.js';
import { getCurrentActor, getDelegationChain, InvalidRequestError } from './index.js';
import type { HttpErrorResponse, Token } from './index.js';

describe('public exports', () => {
  // Values only, since type-only exports leave nothing at runtime.
  it('should export exactly the documented value surface', () => {
    expect(Object.keys(sdk).sort()).toEqual([
      'AuthError',
      'InvalidRequestError',
      'InvalidSessionError',
      'MissingClientAuthError',
      'PoppySessionStore',
      'SessionEndedError',
      'TokenExchangeError',
      'VerifyAccessTokenError',
      'claimCheck',
      'claimEquals',
      'claimIncludes',
      'createAuth0Api',
      'getCurrentActor',
      'getDelegationChain',
      'isConnectionExchangeError',
      'requiresAuth',
      'scopesInclude',
      'toHttpErrorResponse',
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
    // api-js does not export it, so it cannot be re-exported here.
    // `isConnectionExchangeError()` is what this package ships instead.
    //
    // auth-js has deprecated this class as of v1.2.0 and plans to remove it in
    // v2.0 in favour of `TokenExchangeError`, which is already exported above.
    // So the likely change is that this test stays green and the guard widens to
    // accept `token_exchange_error` as well, without consumers changing anything.
    expect('TokenForConnectionError' in sdk).toBe(false);
  });

  it('should re-export the Poppy values of @auth0/auth0-api-js', () => {
    // Identity, not just presence: `instanceof` and `extends` only work across the
    // package boundary when these are the very classes and function api-js exports.
    const names = ['InvalidSessionError', 'PoppySessionStore', 'SessionEndedError', 'toHttpErrorResponse'] as const;

    for (const name of names) {
      // Rules out `undefined === undefined`, which a missing export would give.
      expect(apiJs[name]).toBeTypeOf('function');
      expect(sdk[name]).toBe(apiJs[name]);
    }
  });

  it('should re-export the type of the response that toHttpErrorResponse() returns', () => {
    // A type leaves nothing at runtime, so it is not in the list above. The type check of the specs fails here when the
    // type is not exported, or is another type than the one the function returns.
    expectTypeOf(sdk.toHttpErrorResponse).returns.toEqualTypeOf<HttpErrorResponse | undefined>();
  });

  it('should not export the errors the SDK answers itself, nor the test agent', () => {
    // The SDK answers these itself, so they are not part of this package's surface.
    // The test agent is only on the `./testing` entry point.
    for (const name of [
      'SignInRequiredError',
      'PoppyUnavailableError',
      'InvalidConfigurationError',
      'createTestAgent',
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
