import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { InvalidConfigurationError } from '../errors/index.js';
import { poppyConfig } from '../test-utils/poppy.js';
import { POPPY_CONFIG_FILE_NAME, readPoppyConfigFile } from './config-file.js';

const cannotRead = (path: string) =>
  `Invalid poppy configuration: cannot read the config file at "${path}". ` +
  'Put auth0-poppy.json there, set poppy.configPath to where it is, or pass the parsed file as poppy.config.';

const notJson = (path: string) => `Invalid poppy configuration: the config file at "${path}" is not valid JSON.`;

function thrownBy(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidConfigurationError);
    return error as Error;
  }
  throw new Error('Expected the call to throw.');
}

describe('readPoppyConfigFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'poppy-config-file-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, content: string) {
    const file = join(dir, name);
    writeFileSync(file, content);
    return file;
  }

  test('the default file name is auth0-poppy.json', () => {
    expect(POPPY_CONFIG_FILE_NAME).toBe('auth0-poppy.json');
  });

  describe('reads', () => {
    test('a file by absolute path', () => {
      const file = write('auth0-poppy.json', JSON.stringify(poppyConfig));

      expect(readPoppyConfigFile(file)).toEqual(poppyConfig);
    });

    test('a file by relative path, from the working directory', () => {
      write(POPPY_CONFIG_FILE_NAME, JSON.stringify(poppyConfig));
      vi.spyOn(process, 'cwd').mockReturnValue(dir);

      expect(readPoppyConfigFile(POPPY_CONFIG_FILE_NAME)).toEqual(poppyConfig);
    });

    test('a file by file: URL', () => {
      const file = write('auth0-poppy.json', JSON.stringify(poppyConfig));

      expect(readPoppyConfigFile(pathToFileURL(file))).toEqual(poppyConfig);
    });

    test('a file that starts with a byte order mark', () => {
      const file = write('auth0-poppy.json', '\uFEFF' + JSON.stringify(poppyConfig));

      expect(readPoppyConfigFile(file)).toEqual(poppyConfig);
    });

    test('a file of more than 1 MB: there is no size cap', () => {
      const scopes = Object.fromEntries(
        Array.from({ length: 8000 }, (_, index) => [`scope:${index}`, { description: 'x'.repeat(120) }])
      );
      const big = { ...poppyConfig, scopes };
      const file = write('big.json', JSON.stringify(big));

      expect(statSync(file).size).toBeGreaterThan(1024 * 1024);
      expect(readPoppyConfigFile(file)).toEqual(big);
    });

    test.each([
      ['[]', []],
      ['42', 42],
      ['null', null],
    ])('%s as it is, because the shape is not its job', (text, parsed) => {
      expect(readPoppyConfigFile(write('shape.json', text))).toEqual(parsed);
    });
  });

  describe('cannot read', () => {
    test('a file that is missing', () => {
      const file = join(dir, 'missing.json');

      const error = thrownBy(() => readPoppyConfigFile(file));

      expect(error.message).toBe(cannotRead(file));
      expect(error.cause).toMatchObject({ code: 'ENOENT' });
    });

    test('a file that is missing, given as a file: URL, is named by its path and not by the URL', () => {
      const file = join(dir, 'missing.json');

      const error = thrownBy(() => readPoppyConfigFile(pathToFileURL(file)));

      expect(error.message).toBe(cannotRead(file));
      expect(error.cause).toMatchObject({ code: 'ENOENT' });
    });

    test('a directory', () => {
      const error = thrownBy(() => readPoppyConfigFile(dir));

      expect(error.message).toBe(cannotRead(dir));
      expect(error.cause).toMatchObject({ code: 'EISDIR' });
    });

    test('a file: URL with a host', () => {
      const url = new URL('file://./auth0-poppy.json');

      const error = thrownBy(() => readPoppyConfigFile(url));

      expect(error.message).toBe(cannotRead('file://./auth0-poppy.json'));
      expect(error.cause).toMatchObject({ code: 'ERR_INVALID_FILE_URL_HOST' });
    });

    test('a URL that is not a file: URL', () => {
      const url = new URL('https://zepto.example/auth0-poppy.json');

      const error = thrownBy(() => readPoppyConfigFile(url));

      expect(error.message).toBe(cannotRead(url.href));
      expect(error.cause).toMatchObject({ code: 'ERR_INVALID_URL_SCHEME' });
    });

    test('a string that starts with file: is a relative path like any other', () => {
      vi.spyOn(process, 'cwd').mockReturnValue(dir);

      const error = thrownBy(() => readPoppyConfigFile('file:x.json'));

      expect(error.message).toBe(cannotRead(join(dir, 'file:x.json')));
      expect(error.cause).toMatchObject({ code: 'ENOENT' });
    });
  });

  describe('cannot parse', () => {
    test.each([
      ['an empty file', ''],
      ['a file that is not JSON', '{ oops'],
    ])('%s', (_name, text) => {
      const file = write('auth0-poppy.json', text);

      const error = thrownBy(() => readPoppyConfigFile(file));

      expect(error.message).toBe(notJson(file));
      expect(error.message).not.toContain('oops');
      expect(error.cause).toBeInstanceOf(SyntaxError);
    });
  });
});
