/**
 * @internal
 * The `ServerClient` instances that were made with the `poppy` option. `requiresAuth()` asks it, and it answers from the
 * client of the request, not from `req.app.locals`: in an Express sub-app, `req.app` is the sub-app, and the router never
 * writes its `locals`.
 */
const poppyClients = new WeakSet<object>();

/** @internal Marks a client as one that has Poppy on. */
export function markPoppyClient(client: object): void {
  poppyClients.add(client);
}

/** @internal Whether a client was made with the `poppy` option. */
export function hasPoppy(client: object): boolean {
  return poppyClients.has(client);
}
