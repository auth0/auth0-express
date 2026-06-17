# Dynamic App Base URL Example App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new standalone example app that demonstrates the allow-list mode of `appBaseUrl` in `@auth0/auth0-express`, serving two distinct local domains from a single Express app.

**Architecture:** A new `examples/example-express-dynamic-app-base-url` package, structured identically to the existing `example-express-web`, with `appBaseUrl` configured as a JSON array of two localhost aliases (`app1.localhost:3000` and `app2.localhost:3000`). The SDK's per-request URL resolution picks the correct base URL from the allow-list automatically.

**Tech Stack:** Express 5, TypeScript, EJS, `@auth0/auth0-express`, tsx (dev runner), dotenv

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `examples/example-express-dynamic-app-base-url/package.json` | Package metadata and dependencies |
| Create | `examples/example-express-dynamic-app-base-url/tsconfig.json` | TypeScript config (mirrors example-express-web) |
| Create | `examples/example-express-dynamic-app-base-url/.env.example` | Template env vars with array APP_BASE_URL |
| Create | `examples/example-express-dynamic-app-base-url/src/index.ts` | Express app with allow-list appBaseUrl config |
| Create | `examples/example-express-dynamic-app-base-url/views/layout.ejs` | Shared HTML shell with nav |
| Create | `examples/example-express-dynamic-app-base-url/views/index.ejs` | Home page template |
| Create | `examples/example-express-dynamic-app-base-url/views/public.ejs` | Public page template |
| Create | `examples/example-express-dynamic-app-base-url/views/private.ejs` | Private page template |
| Create | `examples/example-express-dynamic-app-base-url/public/img/auth0.png` | Auth0 logo (binary copy from example-express-web) |
| Create | `examples/example-express-dynamic-app-base-url/README.md` | Setup guide including /etc/hosts and Auth0 tenant config |
| Delete | `docs/superpowers/specs/2026-06-17-dynamic-app-base-url-example-design.md` | Remove spec file after implementation |

---

### Task 1: Scaffold package structure

**Files:**
- Create: `examples/example-express-dynamic-app-base-url/package.json`
- Create: `examples/example-express-dynamic-app-base-url/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
    "name": "example-express-dynamic-app-base-url",
    "version": "1.0.0",
    "description": "",
    "type": "module",
    "scripts": {
        "start": "tsx src/index.ts --project tsconfig.json",
        "build": "tsc --project tsconfig.json"
    },
    "devDependencies": {
        "@types/ejs": "^3.1.5",
        "@types/express": "^5.0.6",
        "ts-node": "^10.9.2",
        "tsx": "^4.21.0",
        "typescript": "~5.9.3"
    },
    "dependencies": {
        "@auth0/auth0-express": "*",
        "dotenv": "^17.2.3",
        "ejs": "^4.0.1",
        "express": "^5.2.1"
    }
}
```

Save to `examples/example-express-dynamic-app-base-url/package.json`.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "incremental": false,
    "isolatedModules": true,
    "lib": [
      "es2022",
      "DOM",
      "DOM.Iterable"
    ],
    "module": "NodeNext",
    "moduleDetection": "force",
    "moduleResolution": "NodeNext",
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src"
  },
  "ts-node": {
    "esm": true,
    "compilerOptions": {
      "module": "nodenext"
    }
  }
}
```

Save to `examples/example-express-dynamic-app-base-url/tsconfig.json`.

- [ ] **Step 3: Install dependencies**

From the repo root:

```bash
npm install
```

Expected: installs without errors, new package appears in workspace.

- [ ] **Step 4: Commit**

```bash
git add examples/example-express-dynamic-app-base-url/package.json examples/example-express-dynamic-app-base-url/tsconfig.json package-lock.json
git commit -m "chore: scaffold example-express-dynamic-app-base-url package"
```

---

### Task 2: Create environment template

**Files:**
- Create: `examples/example-express-dynamic-app-base-url/.env.example`

- [ ] **Step 1: Create .env.example**

```
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
AUTH0_SESSION_SECRET=
APP_BASE_URL=["http://app1.localhost:3000","http://app2.localhost:3000"]
```

Save to `examples/example-express-dynamic-app-base-url/.env.example`.

- [ ] **Step 2: Commit**

```bash
git add examples/example-express-dynamic-app-base-url/.env.example
git commit -m "chore: add .env.example for dynamic app base URL example"
```

---

### Task 3: Create views and static assets

**Files:**
- Create: `examples/example-express-dynamic-app-base-url/views/layout.ejs`
- Create: `examples/example-express-dynamic-app-base-url/views/index.ejs`
- Create: `examples/example-express-dynamic-app-base-url/views/public.ejs`
- Create: `examples/example-express-dynamic-app-base-url/views/private.ejs`
- Create: `examples/example-express-dynamic-app-base-url/public/img/auth0.png`

- [ ] **Step 1: Create layout.ejs**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auth0-Express Dynamic Base URL demo</title>
    <link
      href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
      rel="stylesheet"
      integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"
      crossorigin="anonymous"
    />
  </head>
  <body>
    <nav class="py-2 bg-body-tertiary border-bottom">
      <div class="container d-flex flex-wrap">
        <a
          href="/"
          class="d-flex align-items-center mb-2 mb-lg-0 text-white text-decoration-none"
        >
          <img src="/img/auth0.png" width="36" height="36" alt="Auth0 logo" />
        </a>
        <ul class="nav me-auto">
          <li class="nav-item">
            <a
              href="/public"
              class="nav-link link-body-emphasis px-2 active"
              aria-current="page"
              >Public Page</a
            >
          </li>
          <li class="nav-item">
            <a
              href="/private"
              class="nav-link link-body-emphasis px-2 active"
              aria-current="page"
              >Private Page</a
            >
          </li>
        </ul>
        <ul class="nav">
          <li class="nav-item">
            <% if(isLoggedIn){ %>
            <a class="nav-link link-body-emphasis px-2" href="/auth/logout"
              >Log out <%- locals.user ? '(' + locals.user.name + ')' : '' %></a
            >
            <% } else{ %>
            <a class="nav-link link-body-emphasis px-2" href="/auth/login"
              >Log in</a
            >
            <% } %>
          </li>
        </ul>
      </div>
    </nav>
    <div class="container py-4"><%- body %></div>
    <script
      src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
      integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz"
      crossorigin="anonymous"
    ></script>
  </body>
</html>
```

Save to `examples/example-express-dynamic-app-base-url/views/layout.ejs`.

- [ ] **Step 2: Create index.ejs**

```html
<% if(isLoggedIn){ %> <% if(locals.user){ %>
<h1>Hello, <%= locals.user.name %>!</h1>
<% } %>
<% } else{ %>
<h1>You are not logged in.</h1>
<% } %>
```

Save to `examples/example-express-dynamic-app-base-url/views/index.ejs`.

- [ ] **Step 3: Create public.ejs**

```html
This is a public page.
```

Save to `examples/example-express-dynamic-app-base-url/views/public.ejs`.

- [ ] **Step 4: Create private.ejs**

```html
This is a private page.
```

Save to `examples/example-express-dynamic-app-base-url/views/private.ejs`.

- [ ] **Step 5: Copy Auth0 logo**

```bash
mkdir -p examples/example-express-dynamic-app-base-url/public/img
cp examples/example-express-web/public/img/auth0.png examples/example-express-dynamic-app-base-url/public/img/auth0.png
```

- [ ] **Step 6: Commit**

```bash
git add examples/example-express-dynamic-app-base-url/views/ examples/example-express-dynamic-app-base-url/public/
git commit -m "chore: add views and static assets for dynamic app base URL example"
```

---

### Task 4: Create the Express app

**Files:**
- Create: `examples/example-express-dynamic-app-base-url/src/index.ts`

- [ ] **Step 1: Create src/index.ts**

```typescript
import express, { Request, Response, NextFunction } from 'express';
import { createAuth0 } from '@auth0/auth0-express';
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(
  createAuth0({
    domain: process.env.AUTH0_DOMAIN as string,
    clientId: process.env.AUTH0_CLIENT_ID as string,
    clientSecret: process.env.AUTH0_CLIENT_SECRET as string,
    sessionSecret: process.env.AUTH0_SESSION_SECRET as string,
    // appBaseUrl is intentionally omitted here — the SDK reads APP_BASE_URL from
    // the environment, which is set to a JSON array of allowed origins in .env.
    // This enables per-request URL resolution with allow-list validation.
  })
);

async function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = await req.auth0.client.getSession();

  if (!session) {
    return res.redirect(`/auth/login?returnTo=${encodeURIComponent(req.url)}`);
  }

  next();
}

app.get('/', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('index', { isLoggedIn: !!user, user: user, layout: 'layout' });
});

app.get('/public', async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('public', {
    isLoggedIn: !!user,
    user,
    layout: 'layout',
  });
});

app.get('/private', requireSession, async (req: Request, res: Response) => {
  const user = await req.auth0.client.getUser();

  res.render('private', {
    isLoggedIn: !!user,
    user,
    layout: 'layout',
  });
});

app.listen(3000, () => {
  console.log('Server listening on http://app1.localhost:3000 and http://app2.localhost:3000');
});
```

Save to `examples/example-express-dynamic-app-base-url/src/index.ts`.

- [ ] **Step 2: Commit**

```bash
git add examples/example-express-dynamic-app-base-url/src/index.ts
git commit -m "feat: add Express app for dynamic app base URL example"
```

---

### Task 5: Create README

**Files:**
- Create: `examples/example-express-dynamic-app-base-url/README.md`

- [ ] **Step 1: Create README.md**

````markdown
# Express Dynamic App Base URL Example

This example demonstrates the **allow-list mode** of the `appBaseUrl` configuration in `@auth0/auth0-express`. A single Express application serves two distinct local domains (`app1.localhost` and `app2.localhost`) using the same Auth0 application. The SDK automatically selects the correct base URL per request by matching the incoming origin against a configured allow-list.

## Prerequisites

### 1. Add local host aliases

Add the following entries to your `/etc/hosts` file (requires admin/sudo):

```
127.0.0.1  app1.localhost
127.0.0.1  app2.localhost
```

On macOS/Linux, edit with:

```bash
sudo nano /etc/hosts
```

### 2. Configure your Auth0 application

In the [Auth0 Dashboard](https://manage.auth0.com/), open your application and add the following to each allowed URL field:

**Allowed Callback URLs:**
```
http://app1.localhost:3000/auth/callback, http://app2.localhost:3000/auth/callback
```

**Allowed Logout URLs:**
```
http://app1.localhost:3000, http://app2.localhost:3000
```

**Allowed Web Origins:**
```
http://app1.localhost:3000, http://app2.localhost:3000
```

## Install dependencies

From the repo root:

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in your Auth0 credentials:

```bash
cp .env.example .env
```

```
AUTH0_DOMAIN=YOUR_AUTH0_DOMAIN
AUTH0_CLIENT_ID=YOUR_AUTH0_CLIENT_ID
AUTH0_CLIENT_SECRET=YOUR_AUTH0_CLIENT_SECRET
AUTH0_SESSION_SECRET=YOUR_AUTH0_SESSION_SECRET
APP_BASE_URL=["http://app1.localhost:3000","http://app2.localhost:3000"]
```

The `APP_BASE_URL` value is a JSON array. The SDK parses it automatically and enables allow-list validation — only requests originating from these two URLs are accepted.

Generate a session secret with:

```bash
openssl rand -hex 64
```

## Run the application

```bash
npm run start
```

The server listens on port 3000 and is reachable via both configured domains.

## Test the feature

Open both URLs in your browser and walk through the login/logout flow on each:

- **http://app1.localhost:3000** — login redirects through `http://app1.localhost:3000/auth/callback`
- **http://app2.localhost:3000** — login redirects through `http://app2.localhost:3000/auth/callback`

Both use the **same Auth0 application and the same running Express process**. The SDK resolves the correct base URL per request from the allow-list.

## Routes

- `/` — Home page. Shows the logged-in user's name if authenticated.
- `/public` — Public route, accessible without authentication.
- `/private` — Protected route. Redirects to login if no session exists, then returns here after authentication.
````

Save to `examples/example-express-dynamic-app-base-url/README.md`.

- [ ] **Step 2: Commit**

```bash
git add examples/example-express-dynamic-app-base-url/README.md
git commit -m "docs: add README for dynamic app base URL example"
```

---

### Task 6: Remove spec file

**Files:**
- Delete: `docs/superpowers/specs/2026-06-17-dynamic-app-base-url-example-design.md`

- [ ] **Step 1: Remove the spec file and commit**

```bash
git rm -f docs/superpowers/specs/2026-06-17-dynamic-app-base-url-example-design.md
git commit -m "chore: remove design spec after implementation"
```
