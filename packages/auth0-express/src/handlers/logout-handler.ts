import { Request, Response } from 'express';
import { Auth0ExpressOptions } from 'src/types.js';

export async function handleLogout(req: Request, res: Response, options: Auth0ExpressOptions): Promise<void> {
  try {
    const returnTo = options.appBaseUrl;
    const logoutUrl = await req.auth0.client.logout({ returnTo: returnTo.toString() }, { request: req, response: res });

    res.redirect(logoutUrl.href);
  } catch (error) {
    res.status(500).json({
      error: (error as Error).name,
      message: (error as Error).message,
    });
  }
}
