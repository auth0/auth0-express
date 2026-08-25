import { Request, Response } from 'express';

export async function handleBackchannelLogout(req: Request, res: Response): Promise<void> {
  const logoutToken = req.body.logout_token;

  if (!logoutToken) {
    res.status(400).send('Missing `logout_token` in the request body.');
    return;
  }

  try {
    await req.auth0.client.handleBackchannelLogout(logoutToken);
    res.status(204).send(null);
  } catch {
    // OIDC Back-Channel Logout §2.8 is binary: on success respond 2xx, and "if
    // the logout request was invalid or the logout failed, the RP MUST respond
    // with HTTP 400 Bad Request." We therefore return 400 for any failure —
    // without echoing the internal error detail to the caller (SDK-4).
    res.status(400).send();
  }
}
