# Dynamic Application Base URL — Design

**Date:** 2026-06-08
**Package:** `packages/auth0-express`
**References:** [nextjs-auth0 #2528](https://github.com/auth0/nextjs-auth0/pull/2528) (host inference), [nextjs-auth0 #2538](https://github.com/auth0/nextjs-auth0/pull/2538) (allow-list)

## Goal

Allow the Express SDK to operate without a statically configured `appBaseUrl`, inferring the application base URL from the incoming request at runtime. This supports preview/deploy environments (Vercel, Netlify) where the host is not known at startup. Additionally, support an allow-list (`string[]`) of permitted base URLs — the encouraged production configuration for dynamic hosts.

This ports the behavior of the two referenced Next.js PRs to Express, adapted to the Express SDK's architecture.

## Background: architectural difference from Next.js

In `@auth0/nextjs-auth0`, the base URL is resolved **per request** inside the request lifecycle. In `@auth0/auth0-express`, the `ServerClient` (from `@auth0/auth0-server-js`) is instantiated **once at startup** in `utils.ts`, with `redirect_uri` baked into `authorizationParams`:

```ts
// utils.ts (current)
const redirectUri = createRouteUrl(callbackPath, options.appBaseUrl);
return new ServerClient({
  authorizationParams: { audience, redirect_uri: redirectUri.toString() },
  ...
});
```

The base URL is therefore frozen at startup and reused by the login, callback, and logout handlers. Dynamic base URLs are inherently per-request, so the central change is to **resolve the base URL inside each handler** and override the relevant URL per request.

Two facts make this clean:
- Every handler already receives the Express `Request` (`handleLogin(req, res, options)` etc.).
- `@auth0/auth0-server-js`'s `startInteractiveLogin` accepts `authorizationParams` (including `redirect_uri`), so the startup-time `redirect_uri` can be overridden per request.

## Configuration model

`appBaseUrl` becomes `string | string[] | undefined`:

| Value | Mode | Behavior |
|-------|------|----------|
| `string` (e.g. `"https://app.example.com"`) | Static | Used as-is. Current behavior — fully backward compatible. |
| `string[]` (e.g. `["https://a.example.com", "https://b.example.com"]`) | Allow-list | Per request, infer origin from request and match against the list. Use the match; throw if none matches. **Encouraged for production dynamic hosts.** |
| `undefined` | Dynamic inference | Per request, infer base URL from request host. Auth0 Allowed Callback URLs are the safety gate. |

### Environment variable parsing (`config.ts`)

`APP_BASE_URL` / `BASE_URL`:
- Contains a comma → split, trim, filter empty → `string[]`.
- Otherwise → `string`.
- Unset → `undefined`.

`appBaseUrl` passed explicitly in options always takes precedence over env (unchanged precedence rule).

### Startup validation (`config.ts`)

- Remove the existing hard `MissingRequiredArgumentError('appBaseUrl')` throw. `appBaseUrl` is now optional.
- If `appBaseUrl` is a `string`: must be a parseable absolute `http:`/`https:` URL, else throw `InvalidConfigurationError`.
- If `appBaseUrl` is a `string[]`: must be non-empty (`InvalidConfigurationError` "APP_BASE_URL array configuration cannot be empty"); every entry must be a valid http(s) URL, else throw `InvalidConfigurationError` naming the offending entry/entries.
- If `undefined`: allowed (dynamic mode).
- `domain`, `clientId`, `sessionSecret` validation is unchanged.

## New module: `src/app-base-url.ts`

Ported from the Next.js `src/utils/app-base-url.ts`, with `NextRequest` replaced by Express `Request` and the `isUrl` helper folded in.

```ts
import type { Request } from 'express';
import { InvalidConfigurationError } from './errors/index.js';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return HTTP_PROTOCOLS.has(u.protocol);
  } catch {
    return false;
  }
}

function getFirstHeaderValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [first] = value.split(',');
  return first?.trim() || undefined;
}

export function inferBaseUrlFromRequest(req: Request): string | null {
  const forwardedProto = getFirstHeaderValue(req.headers['x-forwarded-proto'] as string | undefined);
  const forwardedHost = getFirstHeaderValue(req.headers['x-forwarded-host'] as string | undefined);
  const host = forwardedHost || getFirstHeaderValue(req.headers['host']);
  const proto = forwardedProto || req.protocol;
  if (!host || !proto) return null;
  const candidate = `${proto}://${host}`;
  return isUrl(candidate) ? candidate : null;
}

export function resolveAppBaseUrl(appBaseUrl: string | string[] | undefined, req?: Request): string {
  const staticAppBaseUrl = typeof appBaseUrl === 'string' ? appBaseUrl : undefined;
  const allowedAppBaseUrls = typeof appBaseUrl === 'string' ? undefined : appBaseUrl;

  if (staticAppBaseUrl) return staticAppBaseUrl;

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

  if (!allowedAppBaseUrls) return inferred;

  const requestOrigin = new URL(inferred).origin;
  const allowed = allowedAppBaseUrls.some((u) => {
    try {
      return new URL(u).origin === requestOrigin;
    } catch {
      return false;
    }
  });
  if (allowed) return requestOrigin;

  throw new InvalidConfigurationError(
    'APP_BASE_URL is not configured as a static string, and the APP_BASE_URL configuration does not contain a match for the current request origin.'
  );
}
```

Note: Express's `req.protocol` already honors `x-forwarded-proto` when `trust proxy` is enabled. We additionally read forwarded headers explicitly so inference works the same way regardless of the app's `trust proxy` setting, mirroring the Next.js implementation.

## New error: `InvalidConfigurationError`

The SDK currently only defines `MissingStoreOptionsError`. Add an `InvalidConfigurationError` to `src/errors/index.ts` following the same shape (`name`, `code`).

```ts
export class InvalidConfigurationError extends Error {
  public code = 'invalid_configuration_error';
  constructor(message?: string) {
    super(message ?? 'The configuration is invalid.');
    this.name = 'InvalidConfigurationError';
  }
}
```

## Per-request handler changes

The startup `redirect_uri` in `utils.ts` is kept only as the default for the static case (so existing behavior is byte-for-byte unchanged when `appBaseUrl` is a string). In dynamic/allow-list mode it is overridden per request.

### `login-handler.ts`

```ts
const appBaseUrl = resolveAppBaseUrl(options.appBaseUrl, req);
const callbackPath = options.routes?.callback ?? '/auth/callback';
const redirectUri = createRouteUrl(callbackPath, appBaseUrl);
const sanitizedReturnTo = toSafeRedirect(dangerousReturnTo || '/', appBaseUrl);

const authorizationUrl = await req.auth0.client.startInteractiveLogin({
  pushedAuthorizationRequests: options.pushedAuthorizationRequests,
  appState: { returnTo: sanitizedReturnTo },
  authorizationParams: {
    ...filterAuthorizationParams(query, ['returnTo']),
    redirect_uri: redirectUri.toString(),
  },
});
```

`redirect_uri` is set by the SDK after the user-param filter, so it cannot be overridden by query params (it is already in `RESERVED_OAUTH_PARAMS`).

### `callback-handler.ts`

Re-resolve the base from the incoming request (decision: re-resolve, not persist in transaction state — consistent with login; Auth0 Allowed Callback URLs are the real gate):

```ts
const appBaseUrl = resolveAppBaseUrl(options.appBaseUrl, req);
const { appState } = await req.auth0.client.completeInteractiveLogin(
  createRouteUrl(req.url, appBaseUrl)
);
res.redirect(appState?.returnTo ?? appBaseUrl);
```

### `logout-handler.ts`

```ts
const returnTo = resolveAppBaseUrl(options.appBaseUrl, req);
const logoutUrl = await req.auth0.client.logout({ returnTo: returnTo.toString() });
res.redirect(logoutUrl.href);
```

### Runtime error handling

`resolveAppBaseUrl` throws `InvalidConfigurationError` on an unresolvable or disallowed host. The existing `try/catch` in each handler returns `500` with `{ error, message }` JSON. This is consistent with current handler behavior — no new error-handling branch is introduced.

## Secure cookie enforcement

When `NODE_ENV === 'production'` **and** `appBaseUrl` is omitted (pure dynamic mode, i.e. `undefined`), the SDK enforces a secure session cookie:

- If the user did not set `sessionConfiguration.cookie.secure`, force it to `true`.
- If the user explicitly set `sessionConfiguration.cookie.secure === false`, throw `InvalidConfigurationError`.

This is applied in `config.ts` (or a small helper invoked from `createServerClientInstance`). Allow-list mode (`string[]`) entries are validated to be http(s) URLs; if all entries are `https`, the secure default already follows from the resolved origin's protocol via server-js — no extra enforcement is added for allow-list mode in this iteration.

**Scope note:** In the pinned `@auth0/auth0-server-js` version, only the session cookie (`SessionCookieOptions`) exposes a `secure` option. `CookieTransactionStore` takes only `EncryptedStoreOptions` and has no `secure` knob, so transaction-cookie enforcement (which the Next.js PR also does) is **not** applicable here and is out of scope.

## Backward compatibility

- A `string` `appBaseUrl` (the only previously valid form) behaves exactly as before: static `redirect_uri` baked at startup, same secure-cookie derivation, same redirects.
- The `example-express-web` example uses a static `APP_BASE_URL` and continues to work unchanged.
- Removing the startup `MissingRequiredArgumentError('appBaseUrl')` is the only behavioral change for existing configs, and it only relaxes a constraint (omitting it now enables dynamic mode instead of throwing).

## Testing

**`app-base-url.spec.ts` (new):**
- `isUrl`: http/https true; ftp/file/garbage/empty false.
- `inferBaseUrlFromRequest`: host header; `x-forwarded-host`/`x-forwarded-proto` preferred; comma-separated forwarded values take first; missing host → null.
- `resolveAppBaseUrl`: static string returned as-is; undefined + req → inferred; undefined + no req → throws; allow-list match (incl. differing ports, Vercel preview hosts); allow-list miss → throws; invalid entry in allow-list skipped; allow-list + no req → throws.

**`config.spec.ts` (extend):**
- `APP_BASE_URL` with comma → `string[]`.
- `APP_BASE_URL` single → `string`.
- `appBaseUrl` omitted → no throw, `undefined`.
- Invalid static URL → throws `InvalidConfigurationError`.
- Empty array / array with invalid entry → throws `InvalidConfigurationError`.
- Existing precedence/env tests remain green.

**Secure cookie tests:**
- `NODE_ENV=production` + omitted `appBaseUrl` + no explicit secure → secure forced `true`.
- Same + explicit `secure:false` → throws `InvalidConfigurationError`.
- Non-production or static `appBaseUrl` → unchanged.

**Handler tests (extend existing `login-handler.spec.ts`, `callback-handler.spec.ts`):**
- Dynamic mode: `redirect_uri` in the authorization URL reflects the request host (incl. forwarded headers).
- Allow-list mode: matching host succeeds; non-matching host → 500.
- Static mode: behavior unchanged (regression guard).

## Out of scope

- Transaction-cookie `secure` enforcement (no API in the pinned server-js version).
- Changes to `auth0-express-api` package (resource server — no `appBaseUrl`).
- `onCallback`-style hooks for custom redirect resolution (not present in this SDK's handler model).
