import { Request, Response } from 'express';
import { resolveAppBaseUrl } from '../app-base-url.js';
import { Auth0Options } from '../types.js';

export async function handleCallback(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const appBaseUrl = resolveAppBaseUrl(options.appBaseUrl, req);

    // req.url is normally an origin-form path (/auth/callback?...) but can be a full
    // absolute URL when the request arrives via a reverse proxy. new URL() handles both;
    // any parse error is caught by the outer catch and returned as a 500.
    const callbackUrl = new URL(req.url, appBaseUrl);
    if (callbackUrl.origin !== new URL(appBaseUrl).origin) {
      throw new Error('URL is not allowed: origin does not match base URL');
    }

    const { appState } = await req.auth0.client.completeInteractiveLogin<{ returnTo: string } | undefined>(
      callbackUrl
    );

    res.redirect(appState?.returnTo ?? appBaseUrl);
  } catch (e: unknown) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const error = e as any;

    res.status(500).json({
      error: error.cause?.error || error.name,
      message: error.cause?.error_description || error.message,
    });
  }
}
