import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { ApiClient } from '@auth0/auth0-api-js';

// An app can hold two installed copies of this package (a shared library that depends on it, or a monorepo with mixed
// versions). Each copy loads its own `poppy-clients.ts`. `vi.resetModules()` and a new dynamic import make the same
// thing: another instance of the module, with a state of its own.
async function loadCopy() {
  vi.resetModules();
  return import('./poppy-clients.js');
}

describe('the mark of a Poppy client', () => {
  it('should be seen by another copy of the module', async () => {
    const first = await loadCopy();
    const second = await loadCopy();
    const client = {} as ApiClient;

    first.markPoppyClient(client);

    // Rules out one copy loaded twice, which would pass without any sharing.
    expect(second.isPoppyClient).not.toBe(first.isPoppyClient);
    expect(first.isPoppyClient(client)).toBe(true);
    expect(second.isPoppyClient(client)).toBe(true);
  });

  it('should not mark a client that no copy has marked', async () => {
    const first = await loadCopy();
    const second = await loadCopy();
    const client = {} as ApiClient;

    first.markPoppyClient({} as ApiClient);

    expect(first.isPoppyClient(client)).toBe(false);
    expect(second.isPoppyClient(client)).toBe(false);
  });

  it('should keep the clients in a WeakSet under a global symbol, and add nothing to the client', async () => {
    const { markPoppyClient } = await loadCopy();
    const client = {} as ApiClient;

    markPoppyClient(client);

    // The key is what the copies agree on, so a copy of another version finds the same set.
    const shared = (globalThis as unknown as Record<symbol, unknown>)[
      Symbol.for('@auth0/auth0-express-api/poppy-clients')
    ];
    expect(shared).toBeInstanceOf(WeakSet);
    expect((shared as WeakSet<ApiClient>).has(client)).toBe(true);
    expect(Reflect.ownKeys(client)).toEqual([]);
  });

  it('should make requiresAuth() of another copy verify Poppy requests for a client that one copy marked', async () => {
    const { markPoppyClient } = await loadCopy();
    vi.resetModules();
    const { requiresAuth } = await import('../middleware/require-auth.js');

    const verifyPoppyRequest = vi.fn().mockResolvedValue({});
    const client = { verifyPoppyRequest } as unknown as ApiClient;
    markPoppyClient(client);
    const req = { method: 'GET', originalUrl: '/cart', headers: {}, auth0: { client } } as unknown as Request;
    const res = { status: () => res, header: () => res, end: () => res } as unknown as Response;
    const next = vi.fn<(error?: unknown) => void>();

    await requiresAuth()(req, res, next as NextFunction);

    // The other copy took the Poppy path. Without the mark it reads the client as a plain one and verifies no Session.
    expect(verifyPoppyRequest).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });
});
