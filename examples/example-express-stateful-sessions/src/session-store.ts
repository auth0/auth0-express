import type { SessionStore, StateData, LogoutTokenClaims } from '@auth0/auth0-server-js';
import type { StoreOptions } from '@auth0/auth0-express';

/**
 * A custom, server-side session store.
 *
 * By default the SDK uses a *stateless* session: the entire session is
 * encrypted into the cookie. Passing a `sessionStore` to `createAuth0` switches
 * the SDK to a *stateful* session — the cookie then holds only an opaque
 * session ID, and the session data (`StateData`) is persisted here, server-side.
 *
 * This implementation keeps everything in a `Map` for illustration. In
 * production you would back it with a shared, durable store such as Redis or a
 * database so sessions survive restarts and are shared across instances.
 *
 * The `SessionStore<StoreOptions>` interface requires `get`, `set`, `delete`,
 * and `deleteByLogoutToken`. `StoreOptions` carries the Express `request` and
 * `response`, available to each method when you need request context.
 */
export class InMemorySessionStore implements SessionStore<StoreOptions> {
  private readonly store = new Map<string, StateData>();

  async get(identifier: string): Promise<StateData | undefined> {
    return this.store.get(identifier);
  }

  async set(identifier: string, stateData: StateData): Promise<void> {
    this.store.set(identifier, stateData);
  }

  async delete(identifier: string): Promise<void> {
    this.store.delete(identifier);
  }

  /**
   * Called when a Back-Channel Logout token is received. Removes every stored
   * session whose `internal.sid` or `user.sub` matches the logout token claims.
   */
  async deleteByLogoutToken(claims: LogoutTokenClaims): Promise<void> {
    for (const [identifier, state] of this.store.entries()) {
      const matchesSid = claims.sid !== undefined && state.internal?.sid === claims.sid;
      const matchesSub = claims.sub !== undefined && state.user?.sub === claims.sub;
      if (matchesSid || matchesSub) {
        this.store.delete(identifier);
      }
    }
  }

  /** Inspection helper: number of sessions currently stored. */
  get size(): number {
    return this.store.size;
  }

  /** Inspection helper: the identifiers of all stored sessions. */
  keys(): string[] {
    return [...this.store.keys()];
  }
}
