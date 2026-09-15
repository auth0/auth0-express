import { createClient } from 'redis';

/** express-openid-connect session store payload envelope. */
export interface EocStorePayload {
  header: { iat: number; uat: number; exp: number };
  data: Record<string, unknown>;
  cookie: { expires: number; maxAge: number };
}

/**
 * Minimal express-openid-connect custom session store backed by Redis.
 * The store API is get(id) / set(id, payload) / destroy(id) — see express-openid-connect
 * lib/appSession.js CustomStore. Sessions are keyed by the raw session ID (no prefix) and
 * TTL is set from the payload's cookie.maxAge so the auth0-express app reads the same keys.
 */
export async function createRedisStore(url: string) {
  const client = createClient({ url });
  client.on('error', (err) => console.error('Redis error', err));
  await client.connect();

  return {
    async get(id: string): Promise<EocStorePayload | undefined> {
      const raw = await client.get(id);
      return raw ? (JSON.parse(raw) as EocStorePayload) : undefined;
    },
    async set(id: string, payload: EocStorePayload): Promise<void> {
      const ttlSeconds = Math.max(1, Math.floor((payload.cookie?.maxAge ?? 0) / 1000));
      await client.set(id, JSON.stringify(payload), { EX: ttlSeconds });
    },
    async destroy(id: string): Promise<void> {
      await client.del(id);
    },
  };
}
