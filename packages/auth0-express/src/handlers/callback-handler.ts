import { Request, Response } from 'express';
import { createRouteUrl } from '../utils.js';
import { Auth0Options } from '../types.js';

export async function handleCallback(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const { appState } = await req.auth0.client.completeInteractiveLogin<{ returnTo: string } | undefined>(
      createRouteUrl(req.url, options.appBaseUrl)
    );

    res.redirect(appState?.returnTo ?? options.appBaseUrl);
  } catch (error) {
    res.status(500).json({
      error: (error as Error).name,
      message: (error as Error).message,
    });
  }
}
