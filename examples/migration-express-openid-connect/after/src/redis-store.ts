import { createClient } from 'redis';
import type { StateData, SessionStore, LogoutTokenClaims } from '@auth0/auth0-server-js';

/**
 * Redis-backed SessionStore for @auth0/auth0-express.
 *
 * Keys sessions by the raw session ID (same namespace the express-openid-connect example
 * writes to), so migrated sessions are readable by MigrationStatefulStateStore. The value is
 * either an express-openid-connect envelope { header, data, cookie } (legacy, written by the
 * old app) or a StateData object (modern, written here). MigrationStatefulStateStore detects
 * and transforms the legacy shape on read, so this adapter can store/return values verbatim.
 *
 * On set() we also maintain a `logout:sid:<sid> -> <sessionId>` index so deleteByLogoutToken
 * (which only receives { sub, sid }) can resolve to the session key. MigrationStatefulStateStore
 * writes the transformed StateData back on the first get() of a legacy session (not just on the
 * caller's next write), so this index exists as soon as a migrated session is read, not only
 * after some later action re-writes it.
 */
export async function createRedisSessionStore(url: string): Promise<SessionStore<unknown>> {
  const client = createClient({ url });
  client.on('error', (err) => console.error('Redis error', err));
  await client.connect();

  const sidKey = (sid: string) => `logout:sid:${sid}`;

  return {
    async get(id: string): Promise<StateData | undefined> {
      const raw = await client.get(id);
      return raw ? (JSON.parse(raw) as StateData) : undefined;
    },

    async set(id: string, stateData: StateData): Promise<void> {
      await client.set(id, JSON.stringify(stateData));
      const sid = stateData.internal?.sid;
      if (sid) {
        await client.set(sidKey(sid), id);
      }
    },

    async delete(id: string): Promise<void> {
      const raw = await client.get(id);
      if (raw) {
        try {
          const data = JSON.parse(raw) as StateData;
          const sid = data.internal?.sid;
          if (sid) await client.del(sidKey(sid));
        } catch {
          // ignore malformed payloads
        }
      }
      await client.del(id);
    },

    async deleteByLogoutToken(claims: LogoutTokenClaims): Promise<void> {
      const sid = claims.sid;
      if (!sid) return;
      const sessionId = await client.get(sidKey(sid));
      if (sessionId) {
        await client.del(sessionId);
        await client.del(sidKey(sid));
      }
    },
  };
}
