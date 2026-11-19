import { expectTypeOf } from 'vitest';
import { toHttpErrorResponse } from '../src/index.js';
import type {
  Auth0ApiOptions,
  Auth0ApiPoppyOptions,
  HttpErrorResponse,
  InvalidSessionError,
  InvalidSessionReason,
  PoppyAgent,
  PoppySession,
  PoppySessionSource,
  PoppySessionState,
} from '../src/index.js';

// Checked by `npm run test:types`, which runs `tsc` on this file. Vitest does not check types when it runs a spec, so an
// assertion in a spec cannot fail. A type that `src/index.ts` stops exporting, or exports as another type, fails here.

// The response that `toHttpErrorResponse()` returns.
expectTypeOf(toHttpErrorResponse).returns.toEqualTypeOf<HttpErrorResponse | undefined>();

// The types of the members of a verified Session, and the reason of a Session error.
expectTypeOf<PoppySession['state']>().toEqualTypeOf<PoppySessionState>();
expectTypeOf<PoppySession['source']>().toEqualTypeOf<PoppySessionSource>();
expectTypeOf<PoppySession['agent']>().toEqualTypeOf<PoppyAgent>();
expectTypeOf<InvalidSessionError['reason']>().toEqualTypeOf<InvalidSessionReason>();

// The `poppy` option needs `publicOrigin`: the router throws without it, so the type says so before the app runs.
expectTypeOf<Auth0ApiPoppyOptions['publicOrigin']>().toEqualTypeOf<string>();
// The option that `createAuth0Api()` takes is the same type, so a consumer is told at compile time too.
expectTypeOf<NonNullable<Auth0ApiOptions['poppy']>>().toEqualTypeOf<Auth0ApiPoppyOptions>();
// @ts-expect-error `publicOrigin` is required.
const withoutPublicOrigin: Auth0ApiPoppyOptions = { verifySession: true };
void withoutPublicOrigin;
