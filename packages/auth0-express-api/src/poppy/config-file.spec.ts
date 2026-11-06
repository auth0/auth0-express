import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidConfigurationError } from '@auth0/auth0-api-js';
import { loadPoppyOptions, readPoppyConfigFile } from './config-file.js';
import { cannotRead, catchError, cwdAt, notValidJson } from '../test-utils/config-file.js';

const fixtureUrl = new URL('../test-utils/poppy/auth0-poppy.json', import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);
const fixtureDir = dirname(fixturePath);

// What the fixture holds, written out here so the tests do not depend on the code they test to know it.
const fixtureConfig = {
  issuer: 'https://auth0.local/',
  apis: [{ identifier: 'https://api.example.com', public_origin: 'https://api.example.com' }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readPoppyConfigFile', () => {
  it('should read the file at an absolute path', () => {
    expect(readPoppyConfigFile(fixturePath)).toEqual(fixtureConfig);
  });

  it('should resolve a relative path against process.cwd()', () => {
    cwdAt(fixtureDir);

    expect(readPoppyConfigFile('auth0-poppy.json')).toEqual(fixtureConfig);
  });

  it('should read a file: URL', () => {
    expect(readPoppyConfigFile(fixtureUrl)).toEqual(fixtureConfig);
  });

  it('should throw InvalidConfigurationError naming the absolute path when the file is missing', () => {
    const missing = join(fixtureDir, 'missing', 'auth0-poppy.json');

    const error = catchError(() => readPoppyConfigFile(missing));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(cannotRead(missing));
    expect((error.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('should name the path resolved against process.cwd() when a relative path is missing', () => {
    cwdAt(join(fixtureDir, 'missing'));

    const error = catchError(() => readPoppyConfigFile('auth0-poppy.json'));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(cannotRead(join(fixtureDir, 'missing', 'auth0-poppy.json')));
    expect((error.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('should name fileURLToPath(url) when a file: URL is missing', () => {
    const url = new URL('../test-utils/poppy/missing/auth0-poppy.json', import.meta.url);

    const error = catchError(() => readPoppyConfigFile(url));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(cannotRead(fileURLToPath(url)));
    expect((error.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('should name url.href when the URL is not a file: URL', () => {
    const url = new URL('https://example.com/auth0-poppy.json');

    const error = catchError(() => readPoppyConfigFile(url));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(cannotRead('https://example.com/auth0-poppy.json'));
    expect(error.cause).toBeInstanceOf(Error);
  });

  it.each([
    ['a host that is not this machine', 'file://./auth0-poppy.json'],
    ['an encoded slash in the path', 'file:///a%2Fb'],
  ])('should name url.href when a file: URL cannot be turned into a path, for %s', (_label, href) => {
    const url = new URL(href);

    const error = catchError(() => readPoppyConfigFile(url));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(cannotRead(url.href));
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it('should treat any read error as a read failure, such as the path being a folder', () => {
    const error = catchError(() => readPoppyConfigFile(fixtureDir));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(cannotRead(fixtureDir));
    expect((error.cause as NodeJS.ErrnoException).code).toBe('EISDIR');
  });

  it('should throw the not-valid-JSON error without any file content when the file is not JSON', () => {
    const path = join(fixtureDir, 'not-json', 'auth0-poppy.json');

    const error = catchError(() => readPoppyConfigFile(path));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(notValidJson(path));
    expect(error.message).not.toContain('oops');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });
});

// Some editors on Windows save a UTF-8 file with a byte order mark, which `readFileSync()` keeps as U+FEFF.
describe('readPoppyConfigFile with a byte order mark', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'poppy-config-'));
    path = join(dir, 'auth0-poppy.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should read a file that starts with a byte order mark', () => {
    writeFileSync(path, `\uFEFF${JSON.stringify(fixtureConfig)}`);

    expect(readPoppyConfigFile(path)).toEqual(fixtureConfig);
  });

  it('should read the same file with and without the mark', () => {
    writeFileSync(path, JSON.stringify(fixtureConfig));

    expect(readPoppyConfigFile(path)).toEqual(fixtureConfig);
  });

  it('should throw the not-valid-JSON error for a file that holds only the mark', () => {
    writeFileSync(path, '\uFEFF');

    const error = catchError(() => readPoppyConfigFile(path));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(notValidJson(path));
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('should strip the mark only at the start of the file', () => {
    writeFileSync(path, `${JSON.stringify(fixtureConfig)}\uFEFF`);

    const error = catchError(() => readPoppyConfigFile(path));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(notValidJson(path));
  });
});

describe('loadPoppyOptions', () => {
  it('should use config as given, read no file and drop configPath', () => {
    const config = {
      issuer: 'https://auth0.local/',
      apis: [{ identifier: 'https://api.example.com', public_origin: 'https://api.example.com' }],
    };

    const loaded = loadPoppyOptions({ config, configPath: '/does/not/exist.json' });

    expect(loaded).toStrictEqual({ config });
    expect(loaded.config).toBe(config);
    expect('configPath' in loaded).toBe(false);
  });

  it('should read the file at configPath and keep every other option', () => {
    const loaded = loadPoppyOptions({ verifySession: true, configPath: fixturePath });

    expect(loaded).toStrictEqual({ verifySession: true, config: fixtureConfig });
  });

  it('should accept a URL as configPath', () => {
    expect(loadPoppyOptions({ configPath: fixtureUrl })).toStrictEqual({ config: fixtureConfig });
  });

  it('should read the file when config is set to undefined', () => {
    expect(loadPoppyOptions({ config: undefined, configPath: fixturePath })).toStrictEqual({ config: fixtureConfig });
  });

  it('should read auth0-poppy.json from process.cwd() by default and leave a frozen input alone', () => {
    cwdAt(fixtureDir);
    const options = Object.freeze({ verifySession: true });

    const loaded = loadPoppyOptions(options);

    expect(loaded).toStrictEqual({ verifySession: true, config: fixtureConfig });
    expect(loaded).not.toBe(options);
    expect(options).toStrictEqual({ verifySession: true });
  });

  it('should throw the read-failure error when the default file is missing', () => {
    cwdAt(join(fixtureDir, 'missing'));

    const error = catchError(() => loadPoppyOptions({}));

    expect(error).toBeInstanceOf(InvalidConfigurationError);
    expect(error.message).toBe(cannotRead(join(fixtureDir, 'missing', 'auth0-poppy.json')));
  });
});
