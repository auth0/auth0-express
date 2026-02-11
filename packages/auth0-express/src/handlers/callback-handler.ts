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
    // If the error is due to prompt=none and an interaction is required,
    // we should return a 401 to indicate that authentication is required, rather than a 500 which would indicate a server error.
    const statusCode =
      error.cause?.error === 'login_required' ||
      error.cause?.error === 'consent_required' ||
      error.cause?.error === 'interaction_required'
        ? 401
        : 500;

    res.status(statusCode).json({
      error: error.cause?.error || error.name,
      message: error.cause?.error_description || error.message,
    });
  }
}
