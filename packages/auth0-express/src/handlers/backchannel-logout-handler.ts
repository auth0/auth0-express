import { Request, Response, NextFunction } from 'express';

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
    next(error);
  }
}
