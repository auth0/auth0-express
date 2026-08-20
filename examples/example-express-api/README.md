# Express API Example

This example demonstrates how to use the `auth0-express` package to protect API's in an Express application.

## Install dependencies

Install the dependencies using npm:

```bash
npm install
```

## Configuration

Rename `.env.example` to `.env` and configure the domain and audience:

```env
AUTH0_DOMAIN=YOUR_AUTH0_DOMAIN
AUTH0_AUDIENCE=YOUR_AUTH0_AUDIENCE
```

The `/api/on-behalf-of` endpoint additionally needs a confidential client and a second API to call:

```env
AUTH0_CLIENT_ID=YOUR_AUTH0_CLIENT_ID
AUTH0_CLIENT_SECRET=YOUR_AUTH0_CLIENT_SECRET
AUTH0_DOWNSTREAM_AUDIENCE=THE_AUDIENCE_OF_THE_API_YOU_WANT_TO_CALL
```

Leave these unset and every other endpoint still works. `/api/on-behalf-of` is behind `requiresAuth()`, so a call without a token answers `401`. An authenticated call answers `501` when `AUTH0_DOWNSTREAM_AUDIENCE` is missing, rather than calling the tenant with nothing to exchange for, and `500` when `AUTH0_CLIENT_ID` is set without a secret, since the client cannot authenticate to the token endpoint.

### Tenant setup for `/api/on-behalf-of`

On-Behalf-Of exchange also needs the tenant configured for it. The credentials above are not enough on their own:

- This API is registered as a **Custom API client**, so it can authenticate to the token endpoint as a client.
- **On-Behalf-Of Token Exchange** is turned on for that client, under its **Token Exchange** settings. The toggle is on the client doing the exchanging, not on the downstream API.
- There is a **user-delegated client grant** from that client to `AUTH0_DOWNSTREAM_AUDIENCE`.
- User consent is skipped for `AUTH0_DOWNSTREAM_AUDIENCE`, since this is a first-party client.

See [Calling another API on behalf of the user](../../packages/auth0-express-api/EXAMPLES.md#calling-another-api-on-behalf-of-the-user) for the full list and the dashboard steps.

### Configuration for `/api/connection-token`

This endpoint asks Token Vault for an access token issued by a third party the user has connected, so it needs the client credentials above plus the connection to ask for:

```env
AUTH0_CONNECTION=google-oauth2
```

The connection must be set up in Token Vault with the upstream scopes you need, and the calling user must have linked it. A call can answer `502` for a perfectly good setup simply because this user never connected that provider. See [Calling a third party API with Token Vault](../../packages/auth0-express-api/EXAMPLES.md#calling-a-third-party-api-with-token-vault).

### Configuration for `/api/token-exchange`

This endpoint goes the other way, turning a token Auth0 did not issue into one it did. It needs the client credentials, `AUTH0_DOWNSTREAM_AUDIENCE` for the token to ask for, and the token type your Token Exchange Profile accepts:

```env
AUTH0_SUBJECT_TOKEN_TYPE=urn:acme:legacy-token
```

Create a Token Exchange Profile in your tenant with that same `subject_token_type` and an action that validates the incoming token and resolves the user. See [Exchanging an external token for an Auth0 token](../../packages/auth0-express-api/EXAMPLES.md#exchanging-an-external-token-for-an-auth0-token).

With the configuration in place, the example can be started by running:

```bash
npm run start
``` 

## Endpoints

The example API has the following endpoints:

- `GET /api/public`: A public endpoint that can be accessed without authentication.
- `GET /api/private`: A private endpoint that can only be accessed by authenticated users.
- `GET /api/private-scope`: A private endpoint that can only be accessed by authenticated users with the `read:private` scope.
- `GET /api/on-behalf-of`: A private endpoint that exchanges the caller's access token for one issued to `AUTH0_DOWNSTREAM_AUDIENCE`, still representing the same user.
- `GET /api/connection-token`: A private endpoint that exchanges the caller's access token for one issued by `AUTH0_CONNECTION`, so this API can call that provider as the user.
- `POST /api/token-exchange`: A public endpoint that exchanges a token Auth0 did not issue for one it did. Post `{ "token": "..." }` as JSON.

In order to call the `/api/private`, `/api/private-scope`, `/api/on-behalf-of` and `/api/connection-token` endpoints, you need to include an `Authorization` header with a valid access token.

`/api/token-exchange` takes no `Authorization` header, since the caller has no Auth0 token yet. Your Token Exchange Profile is what validates the token in the body.
