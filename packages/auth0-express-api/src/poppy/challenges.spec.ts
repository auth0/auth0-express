import { describe, it, expect } from 'vitest';
import { SignInRequiredError } from '@auth0/auth0-api-js';
import { dpopChallenge } from './challenges.js';

// The challenge lines that `@auth0/auth0-api-js` writes for a request that must sign in for these scopes.
function apiJsChallenges(scope: string): string[] {
  return [new SignInRequiredError({ scope }).headers?.['www-authenticate']].flat().filter((line) => line !== undefined);
}

describe('dpopChallenge', () => {
  it('should build the DPoP challenge that api-js builds for the same scopes', () => {
    const [, dpop] = apiJsChallenges('orders:read orders:write');

    expect(dpopChallenge({ scopes: ['orders:read', 'orders:write'] })).toBe(dpop);
  });

  it('should name the algorithms that api-js names, in a challenge with no other member', () => {
    const [, dpop] = apiJsChallenges('orders:read');
    const algorithms = /algs="[^"]*"/.exec(dpop ?? '')?.[0];

    expect(algorithms).toBeDefined();
    expect(dpopChallenge()).toBe(`DPoP ${algorithms}`);
  });

  it('should write the error, its description and the scopes before the algorithms', () => {
    expect(
      dpopChallenge({ error: 'insufficient_scope', errorDescription: 'Insufficient scopes', scopes: ['a', 'b'] })
    ).toBe('DPoP error="insufficient_scope", error_description="Insufficient scopes", scope="a b", algs="ES256"');
  });

  it('should escape a double quote in the error and its description', () => {
    expect(dpopChallenge({ error: 'a"b', errorDescription: 'c"d' })).toBe(
      'DPoP error="a\\"b", error_description="c\\"d", algs="ES256"'
    );
  });
});

describe('the text of an error_description', () => {
  it('should be cut at 256 characters in the DPoP challenge, before the escaping', () => {
    // A quote at the cut: the escape must not be left without its character.
    const text = `${'a'.repeat(255)}"${'b'.repeat(500)}`;
    const challenge = dpopChallenge({ errorDescription: text });
    const description = /error_description="((?:[^"\\]|\\.)*)"/.exec(challenge)?.[1] ?? '';

    expect(description).toBe(`${'a'.repeat(255)}\\"`);
  });
});
