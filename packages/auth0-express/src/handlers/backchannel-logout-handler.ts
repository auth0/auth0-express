import { Request, Response } from 'express';

// The back-channel logout endpoint is called server-to-server by the OP, not by
// a browser. The SDK owns the response here (rather than delegating to Express
// error middleware via `next`) so the OP always receives a deterministic,
// spec-shaped protocol response — independent of the app's `NODE_ENV` or the
// global error handler it mounts for its browser-facing auth routes.
export async function handleBackchannelLogout(req: Request, res: Response): Promise<void> {
  const logoutToken = req.body.logout_token;

  if (!logoutToken) {
    res.status(400).send('Missing `logout_token` in the request body.');
    return;
  }

  try {
    await req.auth0.client.handleBackchannelLogout(logoutToken);
    // §2.8: success is HTTP 200 OK; an empty-body 204 is an accepted variant.
    res.status(204).send(null);
  } catch {
    // §2.8: "If the logout request was invalid or the logout failed, the RP
    // MUST respond with HTTP 400 Bad Request." We respond with a bare 400 and
    // do not echo the internal error detail to the caller (SDK-4). A JSON
    // `{ error, error_description }` body is only a MAY, so we omit it.
    res.status(400).send();
  }
}
