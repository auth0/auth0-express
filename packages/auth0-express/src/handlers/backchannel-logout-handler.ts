import { Request, Response, NextFunction } from 'express';
import { GenericRequestError } from '../errors/index.js';

export async function handleBackchannelLogout(req: Request, res: Response, next: NextFunction): Promise<void> {
  const logoutToken = req.body.logout_token;

  if (!logoutToken) {
    res.status(400).send('Missing `logout_token` in the request body.');
    return;
  }

  try {
    await req.auth0.client.handleBackchannelLogout(logoutToken);
    res.status(204).send(null);
  } catch (error) {
    // OIDC Back-Channel Logout §2.8 is binary: on success respond 2xx, and "if
    // the logout request was invalid or the logout failed, the RP MUST respond
    // with HTTP 400 Bad Request." Forward a GenericRequestError carrying
    // status 400 so Express's error pipeline emits the spec-mandated status
    // (its default handler reads `err.status`) without echoing detail to the
    // client (SDK-4), while the original error stays on `cause` for the app's
    // error middleware to log or branch on.
    next(new GenericRequestError(400, 'Back-channel logout request could not be processed.', { cause: error }));
  }
}
