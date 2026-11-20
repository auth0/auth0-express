import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidConfigurationError } from '../errors/index.js';

/** The name of the config file that the `poppy` option reads when it is given no `config` and no `configPath`. */
export const POPPY_CONFIG_FILE_NAME = 'poppy.json';

function invalidConfiguration(message: string, ...cause: [] | [unknown]) {
  const error = new InvalidConfigurationError(message);
  if (cause.length > 0) {
    // The constructor takes no options, so set the cause the way `new Error(message, { cause })` does.
    Object.defineProperty(error, 'cause', { value: cause[0], writable: true, configurable: true });
  }
  return error;
}

/** Where the file is, as the startup messages name it. */
function locationOf(path: string | URL) {
  if (typeof path === 'string') {
    return resolve(process.cwd(), path);
  }

  if (path.protocol === 'file:') {
    try {
      return fileURLToPath(path);
    } catch {
      return path.href;
    }
  }

  return path.href;
}

/**
 * Reads the Poppy config file once and returns what `JSON.parse` returns. It checks no shape: the `ServerClient`
 * does that when it is created.
 *
 * A string is a path, resolved against `process.cwd()`. A string that starts with `file:` is a relative path like any
 * other. A `URL` object must be a `file:` URL.
 *
 * The messages name the file and never show its content. When the file cannot be read, the cause of the error holds
 * the details. When it is not valid JSON, the error has no cause, because the message of the parser shows a part of
 * the text of the file.
 *
 * @throws {InvalidConfigurationError} When the file cannot be read or is not valid JSON.
 */
export function readPoppyConfigFile(path: string | URL): unknown {
  const location = locationOf(path);

  let text: string;
  try {
    text = readFileSync(typeof path === 'string' ? location : path, 'utf8');
  } catch (cause) {
    throw invalidConfiguration(
      `Invalid poppy configuration: cannot read the config file at "${location}". ` +
        'Put poppy.json there, set poppy.configPath to where it is, or pass the parsed file as poppy.config.',
      cause
    );
  }

  try {
    // A byte order mark is not valid JSON, and some editors write one.
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    // No cause: the `SyntaxError` of the parser quotes the first characters of the text, and the file may be the wrong
    // one (a `.env`, for example).
    throw invalidConfiguration(`Invalid poppy configuration: the config file at "${location}" is not valid JSON.`);
  }
}
