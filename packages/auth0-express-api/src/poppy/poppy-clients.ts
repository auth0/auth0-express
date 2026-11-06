import type { ApiClient } from '@auth0/auth0-api-js';

// A WeakSet, so the client itself carries no mark and a client nothing else refers to can still be collected. It is
// kept under a key of the global symbol registry, and made by the first copy of this package that loads. So when an
// app holds more than one copy (a shared library that depends on this package, or a monorepo with mixed versions), a
// router made by one is a Poppy router to all of them, and `requiresAuth()` of another copy does not skip the Session
// checks on it.
const REGISTRY = Symbol.for('@auth0/auth0-express-api/poppy-clients');
const shared = globalThis as { [REGISTRY]?: WeakSet<ApiClient> };
const poppyClients = (shared[REGISTRY] ??= new WeakSet<ApiClient>());

/**
 * Remembers that `client` was built with the `poppy` option. `createAuth0Api()` calls it once per client, right after
 * building it, so that middleware that only has the request can tell a client that serves Personal Agents from one
 * that does not.
 */
export function markPoppyClient(client: ApiClient): void {
  poppyClients.add(client);
}

/**
 * Whether `client` was built with the `poppy` option, which is whether `markPoppyClient()` has seen it.
 */
export function isPoppyClient(client: ApiClient): boolean {
  return poppyClients.has(client);
}
