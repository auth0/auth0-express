import { PoppySessionStore } from '@auth0/auth0-express-api';
import type { PoppySessionRecord } from '@auth0/auth0-express-api';

/**
 * Keeps Session records in memory, for a sample. `set` follows the two rules of the store contract: it inserts only if
 * the key is absent, and it resolves to the record that is stored afterwards. A `Map` never forgets a Session, so it
 * grows without limit. A real app keeps the records in its database.
 */
export class MemoryPoppySessionStore extends PoppySessionStore {
  readonly #records = new Map<string, PoppySessionRecord>();

  async get(key: string): Promise<PoppySessionRecord | undefined> {
    return this.#records.get(key);
  }

  // There is no await between the check and the write, so two requests of a new Session that set one key together
  // store one record.
  async set(key: string, record: PoppySessionRecord): Promise<PoppySessionRecord> {
    const existing = this.#records.get(key);
    if (existing) {
      return existing;
    }
    this.#records.set(key, record);
    return record;
  }

  // Ends a Session: later requests with its Session ID are refused with `session_ended`.
  end(key: string): void {
    const record = this.#records.get(key);
    if (record) {
      this.#records.set(key, { ...record, ended: true });
    }
  }
}
