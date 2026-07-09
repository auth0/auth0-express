import { Request, Response, NextFunction } from 'express';
import { createRouteUrl } from '../utils.js';
import { resolveAppBaseUrl } from '../app-base-url.js';
import { Auth0Options } from '../types.js';

export async function handleCallback(req: Request, res: Response, options: Auth0Options, next: NextFunction): Promise<void> {
  try {
    const appBaseUrl = resolveAppBaseUrl(options.appBaseUrl, req);

    const { appState } = await req.auth0.client.completeInteractiveLogin<{ returnTo: string } | undefined>(
      createRouteUrl(req.url, appBaseUrl)
    );

    res.redirect(appState?.returnTo ?? appBaseUrl);
  } catch (error) {
    next(error);
  }
}
