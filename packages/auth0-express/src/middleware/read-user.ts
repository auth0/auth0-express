import type { Request } from 'express';
import { hasPoppy } from '../poppy/enabled.js';

/** The claims of the user of a session, as `getUser()` gives them. */
type User = NonNullable<Awaited<ReturnType<Request['auth0']['client']['getUser']>>>;

/**
 * @internal What the guards need to know about a request: the user of the session, and whether an agent's guest is in
 * the browser.
 *
 * Without the `poppy` option this is `getUser()`, one read, and `guest` is always `false`.
 *
 * With it, `getVisitor()` is the one read. It looks for the guest first, so an agent that has not signed in never passes
 * as a user, even in a state that the SDK does not write (a guest cookie and a session cookie together, after two logins
 * that raced in one browser). Each store is read once, and a store that fails rejects: nobody is let through. A guest has
 * no `user`. The switch is read from the client of the request, not from `req.app.locals`: in a sub-app, `req.app` is not
 * the app that the router is mounted on.
 */
export async function readUser(req: Request): Promise<{ user?: User; guest: boolean }> {
  if (!hasPoppy(req.auth0.client)) {
    return { user: await req.auth0.client.getUser(), guest: false };
  }

  const visitor = await req.auth0.client.poppy.getVisitor();

  return { user: visitor.kind === 'user' ? visitor.user : undefined, guest: visitor.kind === 'guest' };
}
