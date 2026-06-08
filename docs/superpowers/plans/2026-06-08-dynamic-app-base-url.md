# Dynamic Application Base URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `@auth0/auth0-express` to operate with an optional `appBaseUrl` that is `string | string[] | undefined`, inferring the base URL per-request from the incoming host (dynamic mode) or validating it against an allow-list, while keeping static-string configs fully backward compatible.

**Architecture:** Add a request-level base-URL resolver (`app-base-url.ts`) ported from nextjs-auth0. Because the Express SDK builds the `ServerClient` once at startup with a baked-in `redirect_uri`, dynamic resolution happens **inside each handler** (login overrides `redirect_uri` via `startInteractiveLogin`; callback rebuilds the callback URL; logout resolves `returnTo`). Config parsing accepts comma-separated `APP_BASE_URL` as an array, validates entries, and enforces secure session cookies in production dynamic mode.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Express, `@auth0/auth0-server-js` ^1.3.0, Vitest, supertest, msw.

---

## Conventions (read before starting)

- All packages are ESM. **Imports use `.js` extensions** even for `.ts` files (e.g. `import { x } from './errors/index.js'`).
- Work happens entirely in `packages/auth0-express/`.
- Run tests from the repo root with the package filter, or from the package dir. The commands below use the package directory form:
  - `cd packages/auth0-express && npx vitest run <path> -t "<name>"`
- Dependencies may not be installed in this worktree. **Before Task 1, run `npm install` from the repo root** (`/Users/frederikprijck/Development/auth0/auth0-express/.claude/worktrees/dynamic-app-base-url`) and confirm `npx vitest run` works on the existing suite. If install fails, stop and report.
- Each task is committed independently. Commit messages follow the repo's conventional-commit style (`feat:`, `test:`, `docs:`, `refactor:`).

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/auth0-express/src/errors/index.ts` | SDK error classes | Modify — add `InvalidConfigurationError` |
| `packages/auth0-express/src/app-base-url.ts` | `isUrl`, `inferBaseUrlFromRequest`, `resolveAppBaseUrl` | Create |
| `packages/auth0-express/src/app-base-url.spec.ts` | Unit tests for the resolver | Create |
| `packages/auth0-express/src/types.ts` | `Auth0Options.appBaseUrl` type | Modify — `string \| string[]`, optional |
| `packages/auth0-express/src/config.ts` | Env parsing, validation, secure-cookie enforcement | Modify |
| `packages/auth0-express/src/config.spec.ts` | Config tests | Modify — add parsing/validation/secure tests |
| `packages/auth0-express/src/utils.ts` | `createServerClientInstance` startup `redirect_uri` | Modify — handle optional/array base URL |
| `packages/auth0-express/src/handlers/login-handler.ts` | Per-request resolve + `redirect_uri` override | Modify |
| `packages/auth0-express/src/handlers/login-handler.spec.ts` | Login handler tests | Modify — dynamic/allow-list tests |
| `packages/auth0-express/src/handlers/callback-handler.ts` | Per-request resolve for callback URL + redirect | Modify |
| `packages/auth0-express/src/handlers/callback-handler.spec.ts` | Callback handler tests | Modify — dynamic test |
| `packages/auth0-express/src/handlers/logout-handler.ts` | Per-request resolve for `returnTo` | Modify |
| `packages/auth0-express/src/index.ts` | Public exports | Modify — export new symbols |
| `packages/auth0-express/README.md` | Docs | Modify |
| `packages/auth0-express/EXAMPLES.md` | Docs | Modify |

---

## Task 0: Verify the workspace builds and tests pass

**Files:** none (setup only)

- [ ] **Step 1: Install dependencies**

Run from the worktree root:
```bash
npm install
```
Expected: completes without error; `node_modules/` appears at root and/or `packages/auth0-express/node_modules`.

- [ ] **Step 2: Run the existing auth0-express suite (baseline)**

```bash
cd packages/auth0-express && npx vitest run
```
Expected: all existing tests PASS. This is the green baseline. If anything fails before changes, stop and report.

---

## Task 1: Add `InvalidConfigurationError`

**Files:**
- Modify: `packages/auth0-express/src/errors/index.ts`
- Test: `packages/auth0-express/src/errors/index.spec.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `packages/auth0-express/src/errors/index.spec.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { InvalidConfigurationError } from './index.js';

describe('InvalidConfigurationError', () => {
  test('has name and code, and uses provided message', () => {
    const err = new InvalidConfigurationError('bad config');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InvalidConfigurationError');
    expect(err.code).toBe('invalid_configuration_error');
    expect(err.message).toBe('bad config');
  });

  test('falls back to a default message', () => {
    const err = new InvalidConfigurationError();
    expect(err.message).toBe('The configuration is invalid.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/auth0-express && npx vitest run src/errors/index.spec.ts
```
Expected: FAIL — `InvalidConfigurationError` is not exported.

- [ ] **Step 3: Implement the error**

Append to `packages/auth0-express/src/errors/index.ts`:
```ts
export class InvalidConfigurationError extends Error {
  public code: string = 'invalid_configuration_error';

  constructor(message?: string) {
    super(message ?? 'The configuration is invalid.');
    this.name = 'InvalidConfigurationError';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/auth0-express && npx vitest run src/errors/index.spec.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/src/errors/index.ts packages/auth0-express/src/errors/index.spec.ts
git commit -m "feat: add InvalidConfigurationError"
```

---

## Task 2: Create the `app-base-url` resolver — `isUrl`

**Files:**
- Create: `packages/auth0-express/src/app-base-url.ts`
- Test: `packages/auth0-express/src/app-base-url.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/auth0-express/src/app-base-url.spec.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { isUrl } from './app-base-url.js';

describe('isUrl', () => {
  test('returns true for http and https URLs', () => {
    expect(isUrl('http://example.com')).toBe(true);
    expect(isUrl('http://localhost:3000')).toBe(true);
    expect(isUrl('https://myapp.vercel.app')).toBe(true);
  });

  test('returns false for non-http(s) URLs', () => {
    expect(isUrl('ftp://example.com')).toBe(false);
    expect(isUrl('file://example.com')).toBe(false);
  });

  test('returns false for non-URL strings', () => {
    expect(isUrl('not-a-url')).toBe(false);
    expect(isUrl('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/auth0-express && npx vitest run src/app-base-url.spec.ts
```
Expected: FAIL — cannot resolve `./app-base-url.js`.

- [ ] **Step 3: Implement `isUrl`**

Create `packages/auth0-express/src/app-base-url.ts`:
```ts
import type { Request } from 'express';
import { InvalidConfigurationError } from './errors/index.js';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Checks if a string is a valid HTTP or HTTPS URL.
 */
export function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return HTTP_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/auth0-express && npx vitest run src/app-base-url.spec.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/src/app-base-url.ts packages/auth0-express/src/app-base-url.spec.ts
git commit -m "feat: add isUrl helper for app base URL resolution"
```

---

## Task 3: `inferBaseUrlFromRequest`

**Files:**
- Modify: `packages/auth0-express/src/app-base-url.ts`
- Test: `packages/auth0-express/src/app-base-url.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/auth0-express/src/app-base-url.spec.ts` (add `inferBaseUrlFromRequest` to the import at the top: `import { inferBaseUrlFromRequest, isUrl } from './app-base-url.js';`):
```ts
import type { Request } from 'express';

function makeRequest(opts: { headers?: Record<string, string>; protocol?: string }): Request {
  return {
    headers: opts.headers ?? {},
    protocol: opts.protocol ?? 'http',
  } as unknown as Request;
}

describe('inferBaseUrlFromRequest', () => {
  test('uses host header and request protocol', () => {
    const req = makeRequest({ headers: { host: 'example.com' }, protocol: 'https' });
    expect(inferBaseUrlFromRequest(req)).toBe('https://example.com');
  });

  test('prefers x-forwarded-host and x-forwarded-proto over host/protocol', () => {
    const req = makeRequest({
      headers: {
        host: 'internal.local',
        'x-forwarded-host': 'preview.example.com',
        'x-forwarded-proto': 'https',
      },
      protocol: 'http',
    });
    expect(inferBaseUrlFromRequest(req)).toBe('https://preview.example.com');
  });

  test('takes the first value from comma-separated forwarded headers', () => {
    const req = makeRequest({
      headers: {
        'x-forwarded-host': 'preview.example.com, internal.local',
        'x-forwarded-proto': 'https, http',
      },
    });
    expect(inferBaseUrlFromRequest(req)).toBe('https://preview.example.com');
  });

  test('returns null when host cannot be determined', () => {
    const req = makeRequest({ headers: {}, protocol: 'https' });
    expect(inferBaseUrlFromRequest(req)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/auth0-express && npx vitest run src/app-base-url.spec.ts -t "inferBaseUrlFromRequest"
```
Expected: FAIL — `inferBaseUrlFromRequest` is not exported.

- [ ] **Step 3: Implement `inferBaseUrlFromRequest`**

Append to `packages/auth0-express/src/app-base-url.ts`:
```ts
function getFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return undefined;
  }
  const [first] = raw.split(',');
  return first?.trim() || undefined;
}

/**
 * Infers the application base URL from the incoming request.
 * Prefers `x-forwarded-host`/`x-forwarded-proto`, falling back to the `host`
 * header and `req.protocol`. Returns null when a valid origin cannot be built.
 */
export function inferBaseUrlFromRequest(req: Request): string | null {
  const forwardedProto = getFirstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = getFirstHeaderValue(req.headers['x-forwarded-host']);
  const host = forwardedHost || getFirstHeaderValue(req.headers['host']);
  const proto = forwardedProto || req.protocol;

  if (!host || !proto) {
    return null;
  }

  const candidate = `${proto}://${host}`;
  return isUrl(candidate) ? candidate : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/auth0-express && npx vitest run src/app-base-url.spec.ts -t "inferBaseUrlFromRequest"
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/src/app-base-url.ts packages/auth0-express/src/app-base-url.spec.ts
git commit -m "feat: infer app base URL from request host"
```

---

## Task 4: `resolveAppBaseUrl`

**Files:**
- Modify: `packages/auth0-express/src/app-base-url.ts`
- Test: `packages/auth0-express/src/app-base-url.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/auth0-express/src/app-base-url.spec.ts` (update the import to include `resolveAppBaseUrl` and add the error import: `import { InvalidConfigurationError } from './errors/index.js';`). Reuse the `makeRequest` helper defined in Task 3:
```ts
describe('resolveAppBaseUrl', () => {
  test('returns a static string base URL as-is', () => {
    expect(resolveAppBaseUrl('https://app.example.com')).toBe('https://app.example.com');
  });

  test('infers from request when appBaseUrl is undefined', () => {
    const req = makeRequest({ headers: { host: 'preview.example.com' }, protocol: 'https' });
    expect(resolveAppBaseUrl(undefined, req)).toBe('https://preview.example.com');
  });

  test('throws when undefined and no request is available', () => {
    expect(() => resolveAppBaseUrl(undefined)).toThrowError(InvalidConfigurationError);
  });

  test('throws when undefined and the request origin cannot be determined', () => {
    const req = makeRequest({ headers: {} });
    expect(() => resolveAppBaseUrl(undefined, req)).toThrowError(InvalidConfigurationError);
  });

  test('matches the request origin against an allow-list array', () => {
    const req = makeRequest({ headers: { host: 'app2.example.com' }, protocol: 'https' });
    expect(
      resolveAppBaseUrl(['https://app1.example.com', 'https://app2.example.com'], req)
    ).toBe('https://app2.example.com');
  });

  test('matches allow-list entries that differ only by port', () => {
    const req = makeRequest({ headers: { host: 'localhost:3001' }, protocol: 'http' });
    expect(
      resolveAppBaseUrl(['http://localhost:3000', 'http://localhost:3001'], req)
    ).toBe('http://localhost:3001');
  });

  test('throws when the request origin is not in the allow-list', () => {
    const req = makeRequest({ headers: { host: 'unknown.example.com' }, protocol: 'https' });
    expect(() =>
      resolveAppBaseUrl(['https://app1.example.com', 'https://app2.example.com'], req)
    ).toThrowError(InvalidConfigurationError);
  });

  test('throws when an allow-list array is provided but no request is available', () => {
    expect(() => resolveAppBaseUrl(['https://app1.example.com'])).toThrowError(
      InvalidConfigurationError
    );
  });

  test('skips invalid allow-list entries and still matches a valid one', () => {
    const req = makeRequest({ headers: { host: 'app1.example.com' }, protocol: 'https' });
    expect(resolveAppBaseUrl(['not-a-url', 'https://app1.example.com'], req)).toBe(
      'https://app1.example.com'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/auth0-express && npx vitest run src/app-base-url.spec.ts -t "resolveAppBaseUrl"
```
Expected: FAIL — `resolveAppBaseUrl` is not exported.

- [ ] **Step 3: Implement `resolveAppBaseUrl`**

Append to `packages/auth0-express/src/app-base-url.ts`:
```ts
/**
 * Resolves the application base URL for the current request.
 *
 * - `string`: used as-is (static configuration).
 * - `undefined`: inferred from the request host (dynamic mode).
 * - `string[]`: the request origin is matched against the allow-list; the
 *   matching origin is returned, otherwise an error is thrown.
 *
 * @throws {InvalidConfigurationError} When the base URL cannot be resolved.
 */
export function resolveAppBaseUrl(appBaseUrl: string | string[] | undefined, req?: Request): string {
  const staticAppBaseUrl = typeof appBaseUrl === 'string' ? appBaseUrl : undefined;
  const allowedAppBaseUrls = typeof appBaseUrl === 'string' ? undefined : appBaseUrl;

  if (staticAppBaseUrl) {
    return staticAppBaseUrl;
  }

  if (!req) {
    throw new InvalidConfigurationError(
      'APP_BASE_URL is not configured as a static string, and a request context is not available.'
    );
  }

  const inferred = inferBaseUrlFromRequest(req);
  if (!inferred) {
    throw new InvalidConfigurationError(
      'APP_BASE_URL is not configured as a static string, and the request origin could not be determined from the request context.'
    );
  }

  if (!allowedAppBaseUrls) {
    return inferred;
  }

  const requestOrigin = new URL(inferred).origin;
  const isAllowed = allowedAppBaseUrls.some((allowedUrl) => {
    try {
      return new URL(allowedUrl).origin === requestOrigin;
    } catch {
      return false;
    }
  });

  if (isAllowed) {
    return requestOrigin;
  }

  throw new InvalidConfigurationError(
    'APP_BASE_URL is not configured as a static string, and the APP_BASE_URL configuration does not contain a match for the current request origin.'
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/auth0-express && npx vitest run src/app-base-url.spec.ts
```
Expected: PASS (all `isUrl` + `inferBaseUrlFromRequest` + `resolveAppBaseUrl` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/src/app-base-url.ts packages/auth0-express/src/app-base-url.spec.ts
git commit -m "feat: resolve app base URL with allow-list and dynamic inference"
```

---

## Task 5: Widen the `appBaseUrl` type to `string | string[]` and make it optional

**Files:**
- Modify: `packages/auth0-express/src/types.ts:63`

This is a type-only change to unblock later tasks. No new test; type-checking and the existing suite are the guard.

- [ ] **Step 1: Update the type**

In `packages/auth0-express/src/types.ts`, replace the `appBaseUrl` declaration (currently around line 62-63):
```ts
  /** Base URL of your application (e.g., 'http://localhost:3000') */
  appBaseUrl: string;
```
with:
```ts
  /**
   * Base URL of your application (e.g., 'http://localhost:3000').
   *
   * - Provide a single URL string for a static base URL (default behavior).
   * - Provide an array of allowed URLs to validate the incoming request origin
   *   against an allow-list (recommended for dynamic/preview deployments).
   * - Omit it (or set `APP_BASE_URL`/`BASE_URL` empty) to infer the base URL
   *   from the incoming request host at runtime.
   */
  appBaseUrl?: string | string[];
```

- [ ] **Step 2: Type-check / run the suite to confirm nothing broke**

```bash
cd packages/auth0-express && npx vitest run
```
Expected: existing tests still PASS. (Resolver tests already pass; nothing consumes the new union yet.)

- [ ] **Step 3: Commit**

```bash
git add packages/auth0-express/src/types.ts
git commit -m "refactor: allow appBaseUrl to be optional or an array of URLs"
```

---

## Task 6: Parse and validate `appBaseUrl` in `getConfig`

**Files:**
- Modify: `packages/auth0-express/src/config.ts`
- Test: `packages/auth0-express/src/config.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/auth0-express/src/config.spec.ts` (add the error import at the top: `import { InvalidConfigurationError } from './errors/index.js';`):
```ts
describe('appBaseUrl parsing and validation', () => {
  test('parses comma-separated APP_BASE_URL into an array', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    process.env.APP_BASE_URL = 'https://app1.example.com, https://app2.example.com';

    const config = getConfig();

    expect(config.appBaseUrl).toEqual(['https://app1.example.com', 'https://app2.example.com']);
  });

  test('keeps a single APP_BASE_URL as a string', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    process.env.APP_BASE_URL = 'https://app.example.com';

    const config = getConfig();

    expect(config.appBaseUrl).toBe('https://app.example.com');
  });

  test('allows appBaseUrl to be omitted (dynamic mode)', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    delete process.env.APP_BASE_URL;
    delete process.env.BASE_URL;

    const config = getConfig();

    expect(config.appBaseUrl).toBeUndefined();
  });

  test('throws when a static appBaseUrl is not a valid http(s) URL', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';

    expect(() => getConfig({ appBaseUrl: 'not-a-url' })).toThrowError(InvalidConfigurationError);
  });

  test('throws when appBaseUrl is an empty array', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';

    expect(() => getConfig({ appBaseUrl: [] })).toThrowError(
      /APP_BASE_URL array configuration cannot be empty/
    );
  });

  test('throws when an appBaseUrl array contains an invalid URL, naming the entry', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';

    expect(() =>
      getConfig({ appBaseUrl: ['https://valid.com', 'not-a-url'] })
    ).toThrowError(/not-a-url/);
  });
});
```

Also update the existing `'throws error when appBaseUrl is missing'` test (around line 162) — it must no longer throw. Replace its body:
```ts
  test('does not throw when appBaseUrl is missing (dynamic mode)', () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    delete process.env.BASE_URL;
    delete process.env.APP_BASE_URL;

    const config = getConfig();
    expect(config.appBaseUrl).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/auth0-express && npx vitest run src/config.spec.ts -t "appBaseUrl parsing and validation"
```
Expected: FAIL — array not parsed, validation absent (and the renamed test fails because the old throw still fires).

- [ ] **Step 3: Implement parsing and validation in `config.ts`**

In `packages/auth0-express/src/config.ts`:

(a) Add imports at the top:
```ts
import { isUrl } from './app-base-url.js';
import { InvalidConfigurationError } from './errors/index.js';
```

(b) Add a helper above `getConfig`:
```ts
function parseAppBaseUrlEnv(value: string | undefined): string | string[] | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes(',')) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return value;
}

function validateAppBaseUrl(appBaseUrl: string | string[] | undefined): void {
  if (appBaseUrl === undefined) {
    return; // dynamic mode
  }

  if (Array.isArray(appBaseUrl)) {
    if (appBaseUrl.length === 0) {
      throw new InvalidConfigurationError('APP_BASE_URL array configuration cannot be empty.');
    }
    const invalid = appBaseUrl.filter((url) => !isUrl(url));
    if (invalid.length > 0) {
      throw new InvalidConfigurationError(
        `APP_BASE_URL array contains invalid URLs: ${invalid.join(', ')}`
      );
    }
    return;
  }

  if (!isUrl(appBaseUrl)) {
    throw new InvalidConfigurationError(`APP_BASE_URL must be a valid http(s) URL: ${appBaseUrl}`);
  }
}
```

(c) Change the `appBaseUrl` line inside `mergedConfig` (currently `appBaseUrl: process.env.APP_BASE_URL || process.env.BASE_URL,`) to:
```ts
    appBaseUrl: parseAppBaseUrlEnv(process.env.APP_BASE_URL || process.env.BASE_URL),
```

(d) Remove the existing required-arg block:
```ts
  if (!mergedConfig.appBaseUrl) {
    throw new MissingRequiredArgumentError('appBaseUrl');
  }
```
and replace it with:
```ts
  validateAppBaseUrl(mergedConfig.appBaseUrl);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/auth0-express && npx vitest run src/config.spec.ts
```
Expected: PASS — new parsing/validation tests pass, the renamed dynamic-mode test passes, and all other existing config tests remain green.

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/src/config.ts packages/auth0-express/src/config.spec.ts
git commit -m "feat: parse and validate optional/array appBaseUrl in config"
```

---

## Task 7: Enforce secure session cookies in production dynamic mode

**Files:**
- Modify: `packages/auth0-express/src/config.ts`
- Test: `packages/auth0-express/src/config.spec.ts`

Enforcement lives in `getConfig` by normalizing `sessionConfiguration.cookie.secure`. Rule: when `NODE_ENV === 'production'` AND `appBaseUrl` is `undefined` (pure dynamic mode), force `secure = true`; if the user explicitly set `secure === false`, throw.

- [ ] **Step 1: Write the failing tests**

Append to `packages/auth0-express/src/config.spec.ts`:
```ts
describe('secure cookie enforcement in production dynamic mode', () => {
  const baseEnv = () => {
    process.env.AUTH0_DOMAIN = 'auth0.com';
    process.env.AUTH0_CLIENT_ID = 'client_id';
    process.env.AUTH0_SESSION_SECRET = 'secret';
    delete process.env.APP_BASE_URL;
    delete process.env.BASE_URL;
  };

  test('forces session cookie secure=true when production and appBaseUrl omitted', () => {
    baseEnv();
    process.env.NODE_ENV = 'production';

    const config = getConfig();

    expect(config.sessionConfiguration?.cookie?.secure).toBe(true);
  });

  test('throws when secure is explicitly false in production dynamic mode', () => {
    baseEnv();
    process.env.NODE_ENV = 'production';

    expect(() =>
      getConfig({ sessionConfiguration: { cookie: { secure: false } } })
    ).toThrowError(InvalidConfigurationError);
  });

  test('does not force secure when a static appBaseUrl is configured', () => {
    baseEnv();
    process.env.NODE_ENV = 'production';

    const config = getConfig({ appBaseUrl: 'https://app.example.com' });

    expect(config.sessionConfiguration?.cookie?.secure).toBeUndefined();
  });

  test('does not force secure outside production', () => {
    baseEnv();
    process.env.NODE_ENV = 'development';

    const config = getConfig();

    expect(config.sessionConfiguration?.cookie?.secure).toBeUndefined();
  });
});
```

Note: the `config.spec.ts` `beforeEach`/`afterEach` already snapshot and restore `process.env`, so `NODE_ENV` mutations are isolated per test.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/auth0-express && npx vitest run src/config.spec.ts -t "secure cookie enforcement"
```
Expected: FAIL — no enforcement logic yet.

- [ ] **Step 3: Implement enforcement in `config.ts`**

Add a helper above `getConfig`:
```ts
function enforceSecureCookies(config: Auth0Options): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDynamic = config.appBaseUrl === undefined;

  if (!isProduction || !isDynamic) {
    return;
  }

  const explicitSecure = config.sessionConfiguration?.cookie?.secure;
  if (explicitSecure === false) {
    throw new InvalidConfigurationError(
      'Secure cookies are required when relying on dynamic base URLs in production. ' +
        'Remove the explicit `sessionConfiguration.cookie.secure = false` or set a static APP_BASE_URL.'
    );
  }

  config.sessionConfiguration = {
    ...config.sessionConfiguration,
    cookie: {
      ...config.sessionConfiguration?.cookie,
      secure: true,
    },
  };
}
```

Call it in `getConfig` after `validateAppBaseUrl(...)` and before `return mergedConfig;`:
```ts
  enforceSecureCookies(mergedConfig);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/auth0-express && npx vitest run src/config.spec.ts
```
Expected: PASS (new enforcement tests + all existing config tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/src/config.ts packages/auth0-express/src/config.spec.ts
git commit -m "feat: enforce secure session cookies in production dynamic mode"
```

---

## Task 8: Make startup `redirect_uri` tolerate optional/array base URL

**Files:**
- Modify: `packages/auth0-express/src/utils.ts:70-83`

In dynamic/allow-list mode there is no single startup base URL, so the baked-in `redirect_uri` must be computed only when `appBaseUrl` is a static string. The login handler overrides `redirect_uri` per request (Task 9), so a missing startup value is fine.

- [ ] **Step 1: Update `createServerClientInstance`**

In `packages/auth0-express/src/utils.ts`, replace the top of `createServerClientInstance` (currently):
```ts
export function createServerClientInstance(options: Auth0Options) {
  const callbackPath = options.routes?.callback ?? '/auth/callback';
  const redirectUri = createRouteUrl(callbackPath, options.appBaseUrl);

  return new ServerClient<StoreOptions>({
    domain: options.domain,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    clientAssertionSigningKey: options.clientAssertionSigningKey,
    clientAssertionSigningAlg: options.clientAssertionSigningAlg,
    authorizationParams: {
      audience: options.audience,
      redirect_uri: redirectUri.toString(),
    },
```
with:
```ts
export function createServerClientInstance(options: Auth0Options) {
  const callbackPath = options.routes?.callback ?? '/auth/callback';
  // Only a static string base URL yields a startup redirect_uri. In dynamic
  // (undefined) or allow-list (array) mode, the login handler sets redirect_uri
  // per request from the resolved base URL.
  const staticAppBaseUrl = typeof options.appBaseUrl === 'string' ? options.appBaseUrl : undefined;
  const redirectUri = staticAppBaseUrl
    ? createRouteUrl(callbackPath, staticAppBaseUrl).toString()
    : undefined;

  return new ServerClient<StoreOptions>({
    domain: options.domain,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    clientAssertionSigningKey: options.clientAssertionSigningKey,
    clientAssertionSigningAlg: options.clientAssertionSigningAlg,
    authorizationParams: {
      audience: options.audience,
      redirect_uri: redirectUri,
    },
```

(The rest of the function — transaction store, state store, `stateIdentifier`, `customFetch` — is unchanged.)

- [ ] **Step 2: Run the full suite to confirm static mode is unaffected**

```bash
cd packages/auth0-express && npx vitest run
```
Expected: PASS — existing tests use a static `appBaseUrl`, so `redirect_uri` is still set at startup exactly as before.

- [ ] **Step 3: Commit**

```bash
git add packages/auth0-express/src/utils.ts
git commit -m "refactor: only bake startup redirect_uri for static appBaseUrl"
```

---

## Task 9: Resolve base URL per-request in the login handler

**Files:**
- Modify: `packages/auth0-express/src/handlers/login-handler.ts`
- Test: `packages/auth0-express/src/handlers/login-handler.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `packages/auth0-express/src/handlers/login-handler.spec.ts`:
```ts
describe('login handler - dynamic app base URL', () => {
  test('infers redirect_uri from the request host when appBaseUrl is omitted', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      // appBaseUrl omitted -> dynamic mode
    });

    const res = await request(app)
      .get('/auth/login')
      .set('host', 'preview.example.com')
      .set('x-forwarded-proto', 'https');

    expect(res.status).toBe(302);
    const url = new URL(res.headers['location']?.toString() ?? '');
    expect(url.searchParams.get('redirect_uri')).toBe('https://preview.example.com/auth/callback');
  });

  test('uses the matching allow-list entry for redirect_uri', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      appBaseUrl: ['https://app1.example.com', 'https://app2.example.com'],
    });

    const res = await request(app)
      .get('/auth/login')
      .set('host', 'app2.example.com')
      .set('x-forwarded-proto', 'https');

    expect(res.status).toBe(302);
    const url = new URL(res.headers['location']?.toString() ?? '');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app2.example.com/auth/callback');
  });

  test('returns 500 when the request host is not in the allow-list', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      appBaseUrl: ['https://app1.example.com'],
    });

    const res = await request(app)
      .get('/auth/login')
      .set('host', 'evil.example.com')
      .set('x-forwarded-proto', 'https');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('InvalidConfigurationError');
  });
});
```

Note on `x-forwarded-proto`: supertest issues HTTP requests, so `req.protocol` is `http`. Setting `x-forwarded-proto: https` makes `inferBaseUrlFromRequest` produce an `https` origin regardless of Express `trust proxy`, because the resolver reads the header directly.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/auth0-express && npx vitest run src/handlers/login-handler.spec.ts -t "dynamic app base URL"
```
Expected: FAIL — handler still uses `options.appBaseUrl` directly (a non-string is invalid for `toSafeRedirect`, and there is no per-request `redirect_uri`).

- [ ] **Step 3: Update the login handler**

Replace the body of `handleLogin` in `packages/auth0-express/src/handlers/login-handler.ts`. Add imports at the top:
```ts
import { createRouteUrl, toSafeRedirect } from '../utils.js';
import { resolveAppBaseUrl } from '../app-base-url.js';
```
(Remove the existing `import { toSafeRedirect } from '../utils.js';` line — it is replaced by the combined import above.)

New `handleLogin`:
```ts
export async function handleLogin(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const appBaseUrl = resolveAppBaseUrl(options.appBaseUrl, req);
    const callbackPath = options.routes?.callback ?? '/auth/callback';
    const redirectUri = createRouteUrl(callbackPath, appBaseUrl);

    const query = req.query as Record<string, unknown>;
    const dangerousReturnTo = query.returnTo as string | undefined;
    const sanitizedReturnTo = toSafeRedirect(dangerousReturnTo || '/', appBaseUrl);

    const authorizationUrl = await req.auth0.client.startInteractiveLogin({
      pushedAuthorizationRequests: options.pushedAuthorizationRequests,
      appState: { returnTo: sanitizedReturnTo },
      authorizationParams: {
        ...filterAuthorizationParams(query, ['returnTo']),
        redirect_uri: redirectUri.toString(),
      },
    });

    res.redirect(authorizationUrl.href);
  } catch (error) {
    res.status(500).json({
      error: (error as Error).name,
      message: (error as Error).message,
    });
  }
}
```

`redirect_uri` is applied after the spread of `filterAuthorizationParams`, and `redirect_uri` is in `RESERVED_OAUTH_PARAMS`, so a user query value can never override it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/auth0-express && npx vitest run src/handlers/login-handler.spec.ts
```
Expected: PASS — new dynamic tests pass AND all existing login tests (static `appBaseUrl`) still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/src/handlers/login-handler.ts packages/auth0-express/src/handlers/login-handler.spec.ts
git commit -m "feat: resolve app base URL per-request in login handler"
```

---

## Task 10: Resolve base URL per-request in the callback handler

**Files:**
- Modify: `packages/auth0-express/src/handlers/callback-handler.ts`
- Test: `packages/auth0-express/src/handlers/callback-handler.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to the `callback handler` describe in `packages/auth0-express/src/handlers/callback-handler.spec.ts`:
```ts
  test('redirects to the inferred base URL when appBaseUrl is omitted', async () => {
    const app = createConfiguredApp({
      domain: domain,
      clientId: '<client_id>',
      clientSecret: '<client_secret>',
      sessionSecret: '<secret>',
      // appBaseUrl omitted -> dynamic mode
    });

    const cookieName = '__a0_tx';
    const cookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);

    const res = await request(app)
      .get('/auth/callback')
      .query({ code: '123' })
      .set('host', 'preview.example.com')
      .set('x-forwarded-proto', 'https')
      .set('cookie', `${cookieName}=${cookieValue}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://preview.example.com');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/auth0-express && npx vitest run src/handlers/callback-handler.spec.ts -t "inferred base URL"
```
Expected: FAIL — handler passes a non-string `appBaseUrl` to `createRouteUrl`, throwing.

- [ ] **Step 3: Update the callback handler**

Replace the body of `handleCallback` in `packages/auth0-express/src/handlers/callback-handler.ts`. Add import:
```ts
import { resolveAppBaseUrl } from '../app-base-url.js';
```
New body:
```ts
export async function handleCallback(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const appBaseUrl = resolveAppBaseUrl(options.appBaseUrl, req);

    const { appState } = await req.auth0.client.completeInteractiveLogin<{ returnTo: string } | undefined>(
      createRouteUrl(req.url, appBaseUrl)
    );

    res.redirect(appState?.returnTo ?? appBaseUrl);
  } catch (e: unknown) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const error = e as any;

    res.status(500).json({
      error: error.cause?.error || error.name,
      message: error.cause?.error_description || error.message,
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/auth0-express && npx vitest run src/handlers/callback-handler.spec.ts
```
Expected: PASS — new dynamic test + all existing callback tests.

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/src/handlers/callback-handler.ts packages/auth0-express/src/handlers/callback-handler.spec.ts
git commit -m "feat: resolve app base URL per-request in callback handler"
```

---

## Task 11: Resolve base URL per-request in the logout handler

**Files:**
- Modify: `packages/auth0-express/src/handlers/logout-handler.ts`
- Test: `packages/auth0-express/src/index.spec.ts` (add a dynamic logout test near the existing logout tests around line 292)

- [ ] **Step 1: Write the failing test**

Add to `packages/auth0-express/src/index.spec.ts` after the `'auth/logout uses custom route when provided'` test:
```ts
test('auth/logout uses the inferred base URL for post_logout_redirect_uri', async () => {
  const app = createConfiguredApp({
    domain: domain,
    clientId: '<client_id>',
    clientSecret: '<client_secret>',
    sessionSecret: '<secret>',
    // appBaseUrl omitted -> dynamic mode
  });

  const res = await request(app)
    .get('/auth/logout')
    .set('host', 'preview.example.com')
    .set('x-forwarded-proto', 'https');

  const url = new URL(res.headers['location']?.toString() || '');

  expect(res.status).toBe(302);
  expect(url.pathname).toBe('/logout');
  expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://preview.example.com');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/auth0-express && npx vitest run src/index.spec.ts -t "inferred base URL for post_logout_redirect_uri"
```
Expected: FAIL — handler uses `options.appBaseUrl` (undefined) as `returnTo`, calling `.toString()` on `undefined`.

- [ ] **Step 3: Update the logout handler**

Replace the body of `handleLogout` in `packages/auth0-express/src/handlers/logout-handler.ts`. Add import:
```ts
import { resolveAppBaseUrl } from '../app-base-url.js';
```
New body:
```ts
export async function handleLogout(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const returnTo = resolveAppBaseUrl(options.appBaseUrl, req);
    const logoutUrl = await req.auth0.client.logout({ returnTo });

    res.redirect(logoutUrl.href);
  } catch (error) {
    res.status(500).json({
      error: (error as Error).name,
      message: (error as Error).message,
    });
  }
}
```
(`resolveAppBaseUrl` always returns a `string`, so the prior `.toString()` is no longer needed.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/auth0-express && npx vitest run src/index.spec.ts
```
Expected: PASS — new dynamic logout test + all existing index tests.

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/src/handlers/logout-handler.ts packages/auth0-express/src/index.spec.ts
git commit -m "feat: resolve app base URL per-request in logout handler"
```

---

## Task 12: Export new public symbols

**Files:**
- Modify: `packages/auth0-express/src/index.ts`

- [ ] **Step 1: Add exports**

Append to `packages/auth0-express/src/index.ts`:
```ts
export { InvalidConfigurationError } from './errors/index.js';
export { resolveAppBaseUrl, inferBaseUrlFromRequest, isUrl } from './app-base-url.js';
```

- [ ] **Step 2: Run the full suite**

```bash
cd packages/auth0-express && npx vitest run
```
Expected: PASS (entire package suite green).

- [ ] **Step 3: Commit**

```bash
git add packages/auth0-express/src/index.ts
git commit -m "feat: export dynamic app base URL helpers and InvalidConfigurationError"
```

---

## Task 13: Documentation

**Files:**
- Modify: `packages/auth0-express/README.md`
- Modify: `packages/auth0-express/EXAMPLES.md`

- [ ] **Step 1: Read the current docs to find the right insertion points**

```bash
cd packages/auth0-express && grep -n "APP_BASE_URL\|appBaseUrl\|Allowed Callback" README.md EXAMPLES.md
```
Expected: lists the lines mentioning the base URL so you can insert near them.

- [ ] **Step 2: Add a "Dynamic Application Base URLs" section to `EXAMPLES.md`**

Insert this section (place it after the routes/configuration section, matching surrounding heading style):
```markdown
## Dynamic Application Base URLs

By default the SDK uses a static `appBaseUrl` (or `APP_BASE_URL` / `BASE_URL`). For preview/deploy environments where the host is not known at startup, you can either omit it (host inference) or provide an allow-list.

### Host inference (omit `appBaseUrl`)

```ts
import { createAuth0 } from '@auth0/auth0-express';

// APP_BASE_URL omitted; the base URL is inferred from each request's host.
app.use(createAuth0());
```

The SDK reads `x-forwarded-host` / `x-forwarded-proto` (falling back to the `host` header and request protocol) to build the base URL per request.

### Allow-list (recommended for production)

Provide an array of permitted base URLs. The SDK matches the incoming request origin against the list and rejects anything else:

```ts
app.use(createAuth0({
  appBaseUrl: ['https://app.example.com', 'https://myapp.vercel.app'],
}));
```

Via environment variable, use a comma-separated value:

```env
APP_BASE_URL=https://app.example.com,https://myapp.vercel.app
```

> [!IMPORTANT]
> The `Host` header is untrusted input. Auth0's **Allowed Callback URLs** are the primary safeguard: if the resolved host is not registered in your Auth0 application, Auth0 rejects the authorize request. Register every dynamic/preview host you expect.

> [!NOTE]
> When relying on dynamic base URLs (omitted `appBaseUrl`) in production (`NODE_ENV=production`), the SDK enforces a secure session cookie. Explicitly setting `sessionConfiguration.cookie.secure = false` throws `InvalidConfigurationError`.
```

- [ ] **Step 3: Update `README.md`**

In `README.md`, find the line documenting `APP_BASE_URL` as required and soften it. Replace the environment snippet line `APP_BASE_URL=` (or its description) so it reads that the value is optional and supports a comma-separated allow-list, e.g. add directly beneath the env block:
```markdown
`APP_BASE_URL` is optional. Omit it to infer the base URL from the request host (useful for preview deployments), or provide a comma-separated list of allowed URLs. See [Dynamic Application Base URLs](./EXAMPLES.md#dynamic-application-base-urls).
```

- [ ] **Step 4: Verify the suite still passes (docs-only, sanity check)**

```bash
cd packages/auth0-express && npx vitest run
```
Expected: PASS (no code change; confirms nothing was accidentally touched).

- [ ] **Step 5: Commit**

```bash
git add packages/auth0-express/README.md packages/auth0-express/EXAMPLES.md
git commit -m "docs: document dynamic application base URLs"
```

---

## Task 14: Final verification

**Files:** none

- [ ] **Step 1: Run the entire package test suite**

```bash
cd packages/auth0-express && npx vitest run
```
Expected: ALL tests PASS.

- [ ] **Step 2: Type-check / build the package**

```bash
cd packages/auth0-express && npm run build
```
Expected: build succeeds with no TypeScript errors. (If the package has a `typecheck` script, run that too: check `package.json` scripts.)

- [ ] **Step 3: Run the repo-wide check to ensure no sibling package broke**

```bash
cd /Users/frederikprijck/Development/auth0/auth0-express/.claude/worktrees/dynamic-app-base-url && npx turbo run test build 2>/dev/null || (cd packages/auth0-express && npx vitest run && npm run build)
```
Expected: all packages green. (`auth0-express-api` does not use `appBaseUrl`, so it should be unaffected.)

- [ ] **Step 4: Confirm the example app still works conceptually**

```bash
cd /Users/frederikprijck/Development/auth0/auth0-express/.claude/worktrees/dynamic-app-base-url && grep -rn "APP_BASE_URL\|appBaseUrl" examples/example-express-web/
```
Expected: the example uses a static base URL, which remains fully supported (regression-safe).

---

## Self-Review Notes (for the planner — already applied)

- **Spec coverage:** optional/array `appBaseUrl` (Tasks 5, 6), env comma-parsing (Task 6), startup validation (Task 6), `app-base-url.ts` with `isUrl`/`inferBaseUrlFromRequest`/`resolveAppBaseUrl` (Tasks 2-4), `InvalidConfigurationError` (Task 1), per-request login/callback/logout resolution (Tasks 9-11), `redirect_uri` override (Task 9), re-resolve at callback (Task 10), 500 on unresolvable host (Tasks 9-11 catch blocks), secure-cookie enforcement for production dynamic mode session cookie (Task 7), docs (Task 13). Transaction-cookie enforcement is explicitly out of scope per the spec (no server-js API).
- **Type consistency:** `resolveAppBaseUrl(appBaseUrl: string | string[] | undefined, req?: Request): string` is used identically in all three handlers; `Auth0Options.appBaseUrl` is `string | string[]` optional; `isUrl(value: string): boolean`; `inferBaseUrlFromRequest(req: Request): string | null` consistent throughout.
- **No placeholders:** every code step contains full code; every run step has an exact command and expected outcome.
