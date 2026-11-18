import { expectTypeOf } from 'vitest';
import { toHttpErrorResponse } from '../src/index.js';
import type {
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
