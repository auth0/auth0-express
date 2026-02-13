The Auth0 Express SDK is a library for implementing user authentication in Express applications.

![Release](https://img.shields.io/npm/v/@auth0/auth0-express)
![Downloads](https://img.shields.io/npm/dw/@auth0/auth0-express)
[![License](https://img.shields.io/:license-mit-blue.svg?style=flat)](https://opensource.org/licenses/MIT)

📚 [Documentation](#documentation) - 🚀 [Getting Started](#getting-started) - 💬 [Feedback](#feedback)

## Documentation

- [Examples](https://github.com/auth0/auth0-express/blob/main/packages/auth0-express/EXAMPLES.md) - examples for your different use cases.
- [Docs Site](https://auth0.com/docs) - explore our docs site and learn more about Auth0.

## Getting Started

### 1. Install the SDK

```shell
npm i @auth0/auth0-express
```

This library requires Node.js 20 LTS and newer LTS versions.

### 2. Register the Auth0 Express Router

Register the Auth0 Express router with your Express instance.

```ts
import express from 'express';
import { createAuth0 } from '@auth0/auth0-express';

const app = express();

app.use(createAuth0({
  domain: '<AUTH0_DOMAIN>',
  clientId: '<AUTH0_CLIENT_ID>',
  clientSecret: '<AUTH0_CLIENT_SECRET>',
  appBaseUrl: '<APP_BASE_URL>',
  sessionSecret: '<SESSION_SECRET>'
}));
```

The `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, and `AUTH0_CLIENT_SECRET` can be obtained from the [Auth0 Dashboard](https://manage.auth0.com) once you've created an application. **This application must be a `Regular Web Application`**.

The `SESSION_SECRET` is the key used to encrypt the session cookie. You can generate a secret using `openssl`:

```shell
openssl rand -hex 64
```

The `APP_BASE_URL` is the URL that your application is running on. When developing locally, this is most commonly `http://localhost:3000`.

#### Using Environment Variables

The SDK automatically reads configuration from environment variables, making it easy to configure without hardcoding values:

```ts
import express from 'express';
import { createAuth0 } from '@auth0/auth0-express';
import 'dotenv/config'; // Optional: load from .env file

const app = express();

// Configuration is automatically read from environment variables
app.use(createAuth0());
```

Supported environment variables:
- `AUTH0_DOMAIN` - Your Auth0 domain
- `AUTH0_CLIENT_ID` - Your Auth0 application client ID
- `AUTH0_CLIENT_SECRET` - Your Auth0 application client secret (optional)
- `APP_BASE_URL` - Your application base URL
- `AUTH0_SESSION_SECRET` - Secret for session encryption
- `AUTH0_AUDIENCE` - API audience (optional)

Example `.env` file:

```env
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
APP_BASE_URL=http://localhost:3000
AUTH0_SESSION_SECRET=your_long_random_secret_here
```

You can also override specific values while using environment variables for others:

```ts
app.use(createAuth0({
  audience: 'https://api.example.com' // Override while using env vars for other config
}));
```

> [!NOTE]
> For migration from `express-openid-connect`, the following alternative environment variable names are also supported: `ISSUER_BASE_URL` (for domain), `CLIENT_ID`, `CLIENT_SECRET`, `BASE_URL` and `SECRET` (for session secret). These are provided for compatibility but `AUTH0_*` prefixed names are recommended.

> [!IMPORTANT]  
> You will need to register the following URLs in your Auth0 Application via the [Auth0 Dashboard](https://manage.auth0.com):
>
> - Add `http://localhost:3000/auth/callback` to the list of **Allowed Callback URLs**
> - Add `http://localhost:3000` to the list of **Allowed Logout URLs**

#### Routes

The SDK for Express Web Applications mounts 4 main routes:

1. `/auth/login`: the login route that the user will be redirected to to initiate an authentication transaction. Supports adding a `returnTo` querystring parameter to return to a specific URL after login.
2. `/auth/logout`: the logout route that must be added to your Auth0 application's Allowed Logout URLs
3. `/auth/callback`: the callback route that must be added to your Auth0 application's Allowed Callback URLs
4. `/auth/backchannel-logout`: the route that will receive a `logout_token` when a configured [Back-Channel Logout](https://auth0.com/docs/authenticate/login/logout/back-channel-logout) initiator occurs


To disable this behavior, you can set the `mountRoutes` option to `false` (it's true by default):

```ts
app.use(createAuth0({
  mountRoutes: false
}));
```

### 3. Adding Login and Logout

When using the built-in mounted routes, the user can be redirected to `/auth/login` to initiate the login flow and `/auth/logout` to log out.

```html
<a href="/auth/logout">Log out</a>
<a href="/auth/login">Log in</a
>
```

When not using the built-in routes, you want to call the SDK's `startInteractiveLogin()`, `completeInteractiveLogin()` and `logout()` methods:

```ts
app.get('/custom/login', async (req, res) => {
  const authorizationUrl = await req.auth0.client.startInteractiveLogin({
    authorizationParams: {
      // Custom URL to redirect back to after login to handle the callback.
      // Make sure to configure the URL in the Auth0 Dashboard as an Allowed Callback URL.
      redirect_uri: 'http://localhost:3000/custom/callback',
    }
  });

  res.redirect(authorizationUrl.href);
});

app.get('/custom/callback', async (req, res) => {
  await req.auth0.client.completeInteractiveLogin(
    new URL(req.url, req.auth0.config.appBaseUrl)
  );

  res.redirect('https://localhost:3000');
});

app.get('/custom/logout', async (req, res) => {
  const logoutUrl = await req.auth0.client.logout({ returnTo: 'https://localhost:3000' });

  res.redirect(logoutUrl.href);
});
```


### 4. Protecting Routes

In order to protect an Express route, you can use the SDK's `getSession()` method in a custom middleware:

```ts
async function hasSessionMiddleware(req, res, next) {
  const session = await req.auth0.client.getSession();

  if (!session) {
    return res.redirect('/auth/login');
  }

  next();
}

app.get(
  '/profile',
  hasSessionMiddleware,
  async (req, res) => {
    const user = await req.auth0.client.getUser();

    res.render('profile.ejs', {
      name: user!.name,
    });
  }
);
```

> [!IMPORTANT]  
> The above is to protect server-side rendering routes by the means of a session, and not API routes using a bearer token. 


#### Requesting an Access Token to call an API

If you need to call an API on behalf of the user, you want to specify the `audience` parameter when registering the router. This will make the SDK request an access token for the specified audience when the user logs in.

```ts
app.use(createAuth0({
  domain: '<AUTH0_DOMAIN>',
  clientId: '<AUTH0_CLIENT_ID>',
  clientSecret: '<AUTH0_CLIENT_SECRET>',
  audience: '<AUTH0_AUDIENCE>',
  appBaseUrl: '<APP_BASE_URL>',
  sessionSecret: '<SESSION_SECRET>',
}));
```
The `AUTH0_AUDIENCE` is the identifier of the API you want to call. You can find this in the API section of the Auth0 dashboard.

Retrieving the token can be achieved by using `getAccessToken`:

```ts
const accessTokenResult = await req.auth0.client.getAccessToken();
console.log(accessTokenResult.accessToken);
```

## Feedback

### Contributing

We appreciate feedback and contribution to this repo! Before you get started, please read the following:

- [Auth0's general contribution guidelines](https://github.com/auth0/open-source-template/blob/master/GENERAL-CONTRIBUTING.md)
- [Auth0's code of conduct guidelines](https://github.com/auth0/open-source-template/blob/master/CODE-OF-CONDUCT.md)
- [This repo's contribution guide](https://github.com/auth0/auth0-express/blob/main/CONTRIBUTING.md)

### Raise an issue

To provide feedback or report a bug, please [raise an issue on our issue tracker](https://github.com/auth0/auth0-express/issues).

## Vulnerability Reporting

Please do not report security vulnerabilities on the public GitHub issue tracker. The [Responsible Disclosure Program](https://auth0.com/responsible-disclosure-policy) details the procedure for disclosing security issues.

## What is Auth0?

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.auth0.com/website/sdks/logos/auth0_dark_mode.png" width="150">
    <source media="(prefers-color-scheme: light)" srcset="https://cdn.auth0.com/website/sdks/logos/auth0_light_mode.png" width="150">
    <img alt="Auth0 Logo" src="https://cdn.auth0.com/website/sdks/logos/auth0_light_mode.png" width="150">
  </picture>
</p>
<p align="center">
  Auth0 is an easy to implement, adaptable authentication and authorization platform. To learn more checkout <a href="https://auth0.com/why-auth0">Why Auth0?</a>
</p>
<p align="center">
  This project is licensed under the MIT license. See the <a href="https://github.com/auth0/auth0-express/blob/main/packages/auth0-express/LICENSE"> LICENSE</a> file for more info.
</p>