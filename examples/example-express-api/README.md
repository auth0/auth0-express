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

Leave these unset and every other endpoint still works. `/api/on-behalf-of` answers `501` when `AUTH0_DOWNSTREAM_AUDIENCE` is missing, rather than calling the tenant with nothing to exchange for.

### Tenant setup for `/api/on-behalf-of`

On-Behalf-Of exchange also needs the tenant configured for it. The credentials above are not enough on their own:

- This API is registered as a **Custom API client**, so it can authenticate to the token endpoint as a client.
- **On-Behalf-Of Token Exchange** is turned on for that client, under its **Token Exchange** settings. The toggle is on the client doing the exchanging, not on the downstream API.
- There is a **user-delegated client grant** from that client to `AUTH0_DOWNSTREAM_AUDIENCE`.
- User consent is skipped for `AUTH0_DOWNSTREAM_AUDIENCE`, since this is a first-party client.

See [Calling another API on behalf of the user](../../packages/auth0-express-api/EXAMPLES.md#calling-another-api-on-behalf-of-the-user) for the full list and the dashboard steps.

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

In order to call the `/api/private`, `/api/private-scope` and `/api/on-behalf-of` endpoints, you need to include an `Authorization` header with a valid access token.
