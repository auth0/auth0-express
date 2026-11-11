import { describe, expect, expectTypeOf, test } from 'vitest';
import * as serverJs from '@auth0/auth0-server-js';
import * as sdk from './index.js';
import type {
  Auth0Options,
  PoppyActClaim,
  PoppyAgentContext,
  PoppyConfig,
  PoppyConfigIssue,
  PoppyContext,
  PoppyGuestCookieOptions,
  PoppyGuestData,
  PoppyGuestStore,
  PoppyOptions,
  PoppyProtectedResource,
  PoppyVisitor,
  StoreOptions,
} from './index.js';

describe('exports', () => {
  test('should re-export the Poppy values of server-js', () => {
    expect(sdk.AbstractPoppyGuestStore).toBe(serverJs.AbstractPoppyGuestStore);
    expect(sdk.InvalidPoppySessionError).toBe(serverJs.InvalidPoppySessionError);
    expect(sdk.IssuerValidationError).toBe(serverJs.IssuerValidationError);
    expect(sdk.SessionExpiredError).toBe(serverJs.SessionExpiredError);
    expect(sdk.StatelessPoppyGuestStore).toBe(serverJs.StatelessPoppyGuestStore);
  });

  test('should export exactly these values', () => {
    expect(Object.keys(sdk).sort()).toEqual([
      'AbstractPoppyGuestStore',
      'AnonymousSessionError',
      'AnonymousSessionExpiredError',
      'EnterpriseConnectNotSupportedError',
      'InvalidConfigurationError',
      'InvalidPoppySessionError',
      'IssuerValidationError',
      'MissingAnonymousSessionError',
      'SessionExpiredError',
      'StatelessPoppyGuestStore',
      'claimCheck',
      'claimEquals',
      'claimIncludes',
      'createAuth0',
      'isFederatedDomain',
      'isUrl',
      'requiresAuth',
      'resolveAppBaseUrl',
      'startEnterpriseLogin',
    ]);
  });

  // The vitest run does not check these types: `expectTypeOf` and `satisfies` do nothing at run time. Only
  // `tsc --noEmit -p tsconfig.json` (which includes the specs) checks them. No CI job runs that command, and it reports
  // older errors in other specs, so run it by hand after a change to the exports and read the errors of this file.
  test('should export the Poppy types', () => {
    expectTypeOf<PoppyVisitor['kind']>().toEqualTypeOf<'none' | 'anonymous' | 'user' | 'guest'>();
    expectTypeOf<PoppyAgentContext['state']>().toEqualTypeOf<'signed_out' | 'signed_in'>();
    expectTypeOf<NonNullable<Auth0Options['poppy']>>().toEqualTypeOf<true | PoppyOptions>();
    expectTypeOf<PoppyOptions['guestStore']>().toEqualTypeOf<PoppyGuestStore<StoreOptions> | undefined>();

    // One sample of each other type. The `satisfies` is the check, and the length keeps the samples in use.
    const samples = [
      {
        sub: 'https://agent.example/agent.json',
        poppy_sid: 'sid_1',
        poppy_user_id: 'usr_1',
        poppy_agent_id: 'agent_1',
        poppy_session_exp: 1_800_000_000,
      } satisfies PoppyActClaim,
      {
        protocol_version: '0.3',
        organization: { name: 'Zepto', domain: 'zepto.example' },
        issuer: 'https://auth.zepto.example/',
        web: { browser_session_endpoint: 'https://auth.zepto.example/poppy/web_app_client/browser-session' },
      } satisfies PoppyConfig,
      {
        code: 'scopes_not_supported',
        message: 'The metadata lists fewer scopes than the config.',
      } satisfies PoppyConfigIssue,
      { kind: 'human' } satisfies PoppyContext,
      { sameSite: 'lax', secure: true, path: '/' } satisfies PoppyGuestCookieOptions,
      {
        sub: 'anon_poppy@z4eHq6gTjlgaMSjrplb3j5j3kb3hEDz9hZx8mgdxQLg',
        poppy: { sessionId: 'sid_1', userId: 'usr_1', agent: { cimdUrl: 'https://agent.example/agent.json' } },
        tokenSets: [{ audience: 'default', accessToken: 'at_sample', scope: 'orders:read', expiresAt: 1_800_000_000 }],
        createdAt: 1_799_990_000,
        expiresAt: 1_800_000_000,
      } satisfies PoppyGuestData,
      {
        resource: 'https://zepto.example',
        authorization_servers: ['https://auth.zepto.example/'],
        scopes_supported: ['orders:read'],
      } satisfies PoppyProtectedResource,
    ];
    expect(samples).toHaveLength(7);
  });
});
