/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { LegacySessionTransformer } from './legacy-session-transformer.js';

describe('LegacySessionTransformer', () => {
  const transformer = new LegacySessionTransformer('https://api.example.com', 'openid profile');

  /**
   * Builds an unsigned JWT (header.payload.signature) whose payload carries the given claims, so a
   * test can put an arbitrary `sid` claim into the ID token the transformer decodes.
   */
  const makeIdToken = (payload: Record<string, unknown>): string => {
    const b64 = (value: string) =>
      Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify(payload))}.sig`;
  };

  describe('transforms a basic legacy session', () => {
    it('maps tokens, audience, and scope onto StateData', () => {
      const result = transformer.transformLegacySession({
        id_token: makeIdToken({ sub: 'auth0|1', name: 'Test User' }),
        access_token: 'at',
        refresh_token: 'rt',
        expires_at: 1234567890,
      });

      expect(result.user?.sub).toBe('auth0|1');
      expect(result.refreshToken).toBe('rt');
      expect(result.tokenSets).toHaveLength(1);
      expect(result.tokenSets[0]!.accessToken).toBe('at');
      expect(result.tokenSets[0]!.audience).toBe('https://api.example.com');
      expect(result.tokenSets[0]!.scope).toBe('openid profile');
      expect(result.tokenSets[0]!.expiresAt).toBe(1234567890);
    });
  });

  describe('sid resolution (SDK-11514)', () => {
    it('uses a string session-level sid', () => {
      const result = transformer.transformLegacySession({ access_token: 'at', sid: 'session-123' });
      expect(result.internal.sid).toBe('session-123');
    });

    it('falls back to the ID token sid claim when the session has no sid', () => {
      const result = transformer.transformLegacySession({
        access_token: 'at',
        id_token: makeIdToken({ sub: 'auth0|1', sid: 'idtoken-sid' }),
      });
      expect(result.internal.sid).toBe('idtoken-sid');
    });

    it('prefers the session-level sid over the ID token sid claim', () => {
      const result = transformer.transformLegacySession({
        access_token: 'at',
        sid: 'session-sid',
        id_token: makeIdToken({ sub: 'auth0|1', sid: 'idtoken-sid' }),
      });
      expect(result.internal.sid).toBe('session-sid');
    });

    it('resolves to an empty string when no sid is present anywhere', () => {
      const result = transformer.transformLegacySession({
        access_token: 'at',
        id_token: makeIdToken({ sub: 'auth0|1' }),
      });
      expect(result.internal.sid).toBe('');
    });

    it('ignores a non-string session-level sid rather than casting it', () => {
      // A number/object sid (from a corrupt or tampered cookie) must not become internal.sid, which
      // is used verbatim as a store key and in backchannel-logout resolution.
      const numericSid = transformer.transformLegacySession(JSON.parse('{"access_token":"at","sid":12345}'));
      expect(numericSid.internal.sid).toBe('');

      const objectSid = transformer.transformLegacySession(JSON.parse('{"access_token":"at","sid":{"a":1}}'));
      expect(objectSid.internal.sid).toBe('');
    });

    it('ignores a non-string session sid but still falls back to a valid ID token sid', () => {
      const result = transformer.transformLegacySession(
        JSON.parse(`{"access_token":"at","sid":99,"id_token":"${makeIdToken({ sub: 'auth0|1', sid: 'idtoken-sid' })}"}`)
      );
      expect(result.internal.sid).toBe('idtoken-sid');
    });

    it('ignores a non-string ID token sid claim', () => {
      const result = transformer.transformLegacySession({
        access_token: 'at',
        id_token: makeIdToken({ sub: 'auth0|1', sid: { nested: true } }),
      });
      expect(result.internal.sid).toBe('');
    });

    it('always yields a string sid', () => {
      const result = transformer.transformLegacySession(JSON.parse('{"access_token":"at","sid":{"a":1}}'));
      expect(typeof result.internal.sid).toBe('string');
    });
  });

  describe('custom property passthrough hardening (SDK-11512)', () => {
    it('preserves genuine custom properties from the legacy session', () => {
      const result = transformer.transformLegacySession({
        access_token: 'at',
        customProperty: 'custom-value',
        nestedCustom: { foo: 'bar' },
      }) as any;

      expect(result.customProperty).toBe('custom-value');
      expect(result.nestedCustom).toEqual({ foo: 'bar' });
    });

    it('does not reparent the transformed object via a __proto__ key', () => {
      // JSON.parse keeps __proto__ as an OWN enumerable property (an object literal would not), so a
      // crafted payload reaches the passthrough loop. Without the guard, `transformed.__proto__ = x`
      // would trip the __proto__ setter and reparent the object; the guard must skip it.
      const result = transformer.transformLegacySession(
        JSON.parse('{"access_token":"at","__proto__":{"polluted":"yes"}}')
      );

      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect((result as any).polluted).toBeUndefined();
    });

    it('drops a crafted __proto__ key but still copies genuine sibling properties', () => {
      // The guard is a targeted skip of prototype-chain keys, not a blanket halt of the passthrough
      // loop: a crafted __proto__ sibling is dropped while an ordinary custom property in the same
      // payload still passes through. Without the guard, `transformed.__proto__ = {...}` would
      // reparent the object so `result.polluted` would resolve through the injected prototype.
      const result = transformer.transformLegacySession(
        JSON.parse('{"access_token":"at","__proto__":{"polluted":"yes"},"keepMe":"kept"}')
      ) as any;

      expect(result.keepMe).toBe('kept');
      expect(result.polluted).toBeUndefined();
    });

    it('does not let a constructor key shadow the transformed object', () => {
      const result = transformer.transformLegacySession(
        JSON.parse('{"access_token":"at","constructor":{"evil":true}}')
      );

      expect(Object.hasOwn(result, 'constructor')).toBe(false);
      expect(result.constructor).toBe(Object);
    });

    it('does not pass through a prototype key from the legacy session', () => {
      const result = transformer.transformLegacySession(JSON.parse('{"access_token":"at","prototype":{"x":1}}'));

      expect(Object.hasOwn(result, 'prototype')).toBe(false);
    });
  });
});
