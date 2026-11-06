import { vi } from 'vitest';

// Helpers for the specs that read the Poppy config file. They write the texts of the startup errors out in full, so the
// specs fail when the source changes them.

/** The message of the error for a config file that cannot be read. */
export const cannotRead = (path: string) =>
  `Invalid poppy configuration: cannot read the config file at "${path}". ` +
  'Put auth0-poppy.json there, set poppy.configPath to where it is, or pass the parsed file as poppy.config.';

/** The message of the error for a config file that is not JSON. */
export const notValidJson = (path: string) =>
  `Invalid poppy configuration: the config file at "${path}" is not valid JSON.`;

/** Makes `process.cwd()` return `dir`, until the spec restores its mocks. */
export function cwdAt(dir: string) {
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
}

/** Runs `run` and returns the error it throws. Fails when it does not throw. */
export function catchError(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected the call to throw, but it returned.');
}
