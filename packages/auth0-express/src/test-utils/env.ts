/**
 * Runs `fn` with `process.env.NODE_ENV` temporarily set to `value` (or deleted
 * when `value` is `undefined`), restoring the previous value afterwards.
 *
 * Express captures its `env` from `NODE_ENV` at app-construction time, and
 * finalhandler uses it to decide whether to include the error stack in a
 * response body, so a test that wants to assert the behavior of a specific
 * environment must set `NODE_ENV` before it builds the app. Centralized here so
 * the save/set/restore is not copy-pasted into every such test.
 */
export async function withNodeEnv(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const original = process.env.NODE_ENV;
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
  try {
    await fn();
  } finally {
    if (original === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = original;
    }
  }
}
