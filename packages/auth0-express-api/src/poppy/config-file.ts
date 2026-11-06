import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidConfigurationError } from '@auth0/auth0-api-js';
import type { PoppyConfig, PoppyOptions } from '@auth0/auth0-api-js';
import type { Auth0ApiPoppyOptions } from '../types.js';

/** The name of the Poppy config file, which is looked for in `process.cwd()` unless `configPath` says otherwise. */
export const POPPY_CONFIG_FILE_NAME = 'auth0-poppy.json';

function invalidConfiguration(message: string, cause: unknown): InvalidConfigurationError {
  const error = new InvalidConfigurationError(message);
  // The constructor takes only the message, so the original error is set afterwards.
  error.cause = cause;
  return error;
}

// What the error messages name: the absolute path that was read, or the address of a URL that is not a file.
function locationOf(source: string | URL): string {
  if (typeof source === 'string') {
    return source;
  }
  if (source.protocol !== 'file:') {
    return source.href;
  }
  try {
    return fileURLToPath(source);
  } catch {
    // A `file:` URL that is no path on this machine, such as `file://./auth0-poppy.json`. Reading it fails too, and the
    // read failure that is reported names the address instead.
    return source.href;
  }
}

/**
 * Reads and parses the Poppy config file, `auth0-poppy.json`.
 *
 * A string is a path and is resolved against `process.cwd()`, so a relative one is read from the folder the app was
 * started in. A `file:` `URL` is read as it is. A UTF-8 byte order mark at the start of the file is ignored.
 *
 * The shape of the parsed value is not checked here. The `ApiClient` constructor checks it, and its error reaches the
 * caller of `createAuth0Api()` unchanged.
 *
 * @param path - Where the file is
 * @returns The parsed JSON
 * @throws InvalidConfigurationError when the file cannot be read or is not valid JSON. `cause` holds the original
 * error. The message names the file and never holds its content.
 */
export function readPoppyConfigFile(path: string | URL): unknown {
  const source = typeof path === 'string' ? resolve(process.cwd(), path) : path;
  const location = locationOf(source);

  let text: string;
  try {
    text = readFileSync(source, 'utf8');
  } catch (error) {
    throw invalidConfiguration(
      `Invalid poppy configuration: cannot read the config file at "${location}". ` +
        'Put auth0-poppy.json there, set poppy.configPath to where it is, or pass the parsed file as poppy.config.',
      error
    );
  }

  try {
    // `readFileSync()` keeps the byte order mark that some editors on Windows put at the start of a UTF-8 file, and
    // `JSON.parse()` refuses it.
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    // The SyntaxError can quote the text it choked on, so it stays in `cause` and out of the message.
    throw invalidConfiguration(
      `Invalid poppy configuration: the config file at "${location}" is not valid JSON.`,
      error
    );
  }
}

/**
 * Turns the `poppy` option of `createAuth0Api()` into the `poppy` option of `ApiClient`, by supplying the config.
 *
 * The result is a new object with every option except `configPath`, plus `config`: the `config` given, when there is
 * one, and otherwise the parsed file at `configPath` (default: `auth0-poppy.json` in `process.cwd()`). The input is
 * never changed.
 *
 * @param options - The `poppy` option of `createAuth0Api()`
 * @returns The `poppy` option for `ApiClient`
 * @throws InvalidConfigurationError as `readPoppyConfigFile()` does, when a file is read
 */
export function loadPoppyOptions(options: Auth0ApiPoppyOptions): PoppyOptions {
  const { config, configPath, ...rest } = options;

  if (config !== undefined) {
    return { ...rest, config };
  }

  // The cast trusts the file. The `ApiClient` constructor checks the shape.
  return { ...rest, config: readPoppyConfigFile(configPath ?? POPPY_CONFIG_FILE_NAME) as PoppyConfig };
}
