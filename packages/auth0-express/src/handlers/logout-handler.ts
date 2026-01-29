import { Request, Response } from 'express';
import { Auth0Options } from '../types.js';

export async function handleLogout(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const returnTo = options.appBaseUrl;
    const logoutUrl = await req.auth0.client.logout({ returnTo: returnTo.toString() });

    res.redirect(logoutUrl.href);
  } catch (error) {
    res.status(500).json({
      error: (error as Error).name,
      message: (error as Error).message,
    });
  }
}
