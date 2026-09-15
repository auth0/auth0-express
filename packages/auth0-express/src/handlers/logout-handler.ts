import { Request, Response, NextFunction } from 'express';
import { resolveAppBaseUrl } from '../app-base-url.js';
import { Auth0Options } from '../types.js';

export async function handleLogout(req: Request, res: Response, options: Auth0Options, next: NextFunction): Promise<void> {
  try {
    const returnTo = resolveAppBaseUrl(options.appBaseUrl, req);
    const logoutUrl = await req.auth0.client.logout({ returnTo });

    res.redirect(logoutUrl.href);
  } catch (error) {
    next(error);
  }
}
