import { describe, expect, test } from 'vitest';
import type { StateData } from '@auth0/auth0-server-js';
import { InMemorySessionStore } from './session-store.js';

// A minimal StateData value for round-trip tests.
const sampleState = (): StateData => ({
  user: { sub: 'auth0|user_123', name: 'Jane Doe' },
  idToken: 'id-token',
  refreshToken: undefined,
  tokenSets: [],
  internal: { sid: 'sid_123', createdAt: Math.floor(Date.now() / 1000) },
});

describe('InMemorySessionStore', () => {
  test('set then get returns the stored state', async () => {
    const store = new InMemorySessionStore();
    const state = sampleState();

    await store.set('abc', state);

    expect(await store.get('abc')).toEqual(state);
  });

  test('get returns undefined for an unknown id', async () => {
    const store = new InMemorySessionStore();
    expect(await store.get('missing')).toBeUndefined();
  });

  test('delete removes the stored state', async () => {
    const store = new InMemorySessionStore();
    await store.set('abc', sampleState());

    await store.delete('abc');

    expect(await store.get('abc')).toBeUndefined();
  });

  test('deleteByLogoutToken removes sessions matching the sub claim', async () => {
    const store = new InMemorySessionStore();
    await store.set('abc', sampleState());

    await store.deleteByLogoutToken({ sub: 'auth0|user_123' });

    expect(await store.get('abc')).toBeUndefined();
  });

  test('deleteByLogoutToken removes sessions matching the sid claim', async () => {
    const store = new InMemorySessionStore();
    await store.set('abc', sampleState());

    await store.deleteByLogoutToken({ sid: 'sid_123' });

    expect(await store.get('abc')).toBeUndefined();
  });

  test('deleteByLogoutToken leaves non-matching sessions intact', async () => {
    const store = new InMemorySessionStore();
    await store.set('abc', sampleState());

    await store.deleteByLogoutToken({ sub: 'auth0|someone_else' });

    expect(await store.get('abc')).toBeDefined();
  });
});
