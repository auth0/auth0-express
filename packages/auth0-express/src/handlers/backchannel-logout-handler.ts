import { Request, Response } from 'express';

export async function handleBackchannelLogout(req: Request, res: Response): Promise<void> {
  const logoutToken = req.body.logout_token;

  if (!logoutToken) {
    res.status(400).send('Missing `logout_token` in the request body.');
    return;
  }

  try {
    await req.auth0.client.handleBackchannelLogout(logoutToken, { request: req, response: res });
    res.status(204).send(null);
  } catch (e) {
    res.status(400).send((e as Error).message);
  }
}
