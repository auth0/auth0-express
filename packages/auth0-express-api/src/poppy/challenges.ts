import type { Response } from 'express';

// The DPoP algorithms `@auth0/auth0-api-js` accepts for a proof. It is `ES256` only, and `challenges.spec.ts` compares
// the challenge below with the one that `SignInRequiredError` of api-js builds, so a change there fails this package.
const DPOP_ALGORITHMS = 'ES256';

interface ChallengeParams {
  error?: string;
  errorDescription?: string;
  scopes?: string[];
}

/**
 * Replaces every character outside printable ASCII with `?`. A header value cannot hold a CR, an LF or another control
 * character: `setHeader` throws for one, and the text of a challenge can come from the client (a library error that
 * quotes a JWT header, for example), so it must never reach a header as it is.
 */
export function printable(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?');
}

/** A quoted string of RFC 9110 (section 5.6.4): printable ASCII, with a backslash before `\` and `"`. */
function quoted(value: string): string {
  return `"${printable(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/**
 * The `DPoP` challenge (RFC 9449, section 5.1), as the value of a `WWW-Authenticate` header. The members come in the
 * order that api-js writes them in: `error`, `error_description`, `scope`, then `algs`.
 */
export function dpopChallenge(params: ChallengeParams = {}): string {
  const attributes = [
    params.error === undefined ? undefined : `error=${quoted(params.error)}`,
    params.errorDescription === undefined ? undefined : `error_description=${quoted(params.errorDescription)}`,
    params.scopes === undefined ? undefined : `scope=${quoted(params.scopes.join(' '))}`,
    `algs="${DPOP_ALGORITHMS}"`,
  ].filter((attribute) => attribute !== undefined);

  return `DPoP ${attributes.join(', ')}`;
}

/**
 * Answers a request that has no credentials the API can use with `401` and the two challenges that a router with the
 * `poppy` option accepts: `Bearer` and `DPoP`. A router without it accepts only `Bearer`, and says so.
 */
export function sendNoCredentials(res: Response): void {
  res.status(401).set('WWW-Authenticate', ['Bearer', dpopChallenge()]).end();
}
