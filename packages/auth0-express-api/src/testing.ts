/**
 * Test helpers for an API that serves Personal Agents (the beta Poppy API).
 *
 * For tests only: never import this entry point from production code. It re-exports the test agent of
 * `@auth0/auth0-api-js/testing`, so an app needs no direct dependency on that package. `createTestAgent()` makes a fake
 * Personal Agent that signs `Poppy-Session` headers and serves its own metadata. No network is needed only when you
 * pass the `fetch` of the agent as `agentMetadata.fetch` in the `poppy` option: otherwise the API fetches the metadata
 * from the address of the agent.
 *
 * @beta
 */
export { createTestAgent } from '@auth0/auth0-api-js/testing';
export type {
  CreateTestAgentOptions,
  TestAgent,
  TestSessionJwtDefect,
  TestSessionJwtOptions,
} from '@auth0/auth0-api-js/testing';
