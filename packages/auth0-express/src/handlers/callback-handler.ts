import { Request, Response } from 'express';
import { createRouteUrl } from '../utils.js';
import { Auth0Options } from '../types.js';

export async function handleCallback(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const { appState } = await req.auth0.client.completeInteractiveLogin<{ returnTo: string } | undefined>(
      createRouteUrl(req.url, options.appBaseUrl)
    );

    res.redirect(appState?.returnTo ?? options.appBaseUrl);
  } catch (e: unknown) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const error = e as any;

    res.status(500).json({
      error: error.cause?.error || error.name,
      message: error.cause?.error_description || error.message,
    });
  }
}
