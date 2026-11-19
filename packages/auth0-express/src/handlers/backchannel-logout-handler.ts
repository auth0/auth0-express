import { NextFunction, Request, Response, urlencoded } from 'express';

const parseForm = urlencoded({ extended: false });

/**
 * Reads the body of a back-channel logout request. Auth0 sends the `logout_token` as `application/x-www-form-urlencoded`
 * (OpenID Connect Back-Channel Logout, section 2.5), and the router mounts no body parser for the app, so the route
 * parses the form itself. A parser that the app mounted earlier has already read the body, and this one leaves it as it
 * is. A body that cannot be read is answered as any other failure here, with a bare `400`.
 */
export function parseBackchannelLogoutBody(req: Request, res: Response, next: NextFunction): void {
  // A body that something else has already read cannot be read again. The body parser of Express 5 sees this, but the one
  // of Express 4 only knows the bodies that it read itself, and it would refuse this one with an error.
  if (req.readableEnded) {
    next();
    return;
  }

  parseForm(req, res, (error?: unknown) => {
    if (error) {
      res.status(400).send();
      return;
    }

    next();
  });
}

/**
 * Passes the `logout_token` of a back-channel logout request to the client, and answers `204`. Any failure is answered
 * with a bare `400`, and the returned promise never rejects.
 */
export async function handleBackchannelLogout(req: Request, res: Response): Promise<void> {
  // Express 4 does not catch a promise that a handler rejects, and that ends the process, so every failure is answered
  // here and the promise never rejects.
  try {
    const logoutToken = req.body?.logout_token;

    if (!logoutToken) {
      res.status(400).send('Missing `logout_token` in the request body.');
      return;
    }

    await req.auth0.client.handleBackchannelLogout(logoutToken);
    res.status(204).send(null);
  } catch {
    if (!res.headersSent) {
      res.status(400).send();
    }
  }
}
