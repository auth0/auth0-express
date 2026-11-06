import { describe, it, expect } from 'vitest';
import { createTestAgent as apiJsCreateTestAgent } from '@auth0/auth0-api-js/testing';
import * as testing from './testing.js';

describe('testing entry point', () => {
  it('should export exactly the test agent factory as a value', () => {
    // Values only, since type-only exports leave nothing at runtime.
    expect(Object.keys(testing)).toEqual(['createTestAgent']);
  });

  it('should re-export createTestAgent of @auth0/auth0-api-js/testing', () => {
    // Rules out `undefined === undefined`, which a missing export would give.
    expect(apiJsCreateTestAgent).toBeTypeOf('function');
    expect(testing.createTestAgent).toBe(apiJsCreateTestAgent);
  });
});
