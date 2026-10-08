import { Request, Response, NextFunction } from 'express';
import { createRouteUrl } from '../utils.js';
import { resolveAppBaseUrl } from '../app-base-url.js';
import { sanitizeHandlerError } from '../errors.js';
import { Auth0Options } from '../types.js';

export async function handleCallback(req: Request, res: Response, options: Auth0Options, next: NextFunction): Promise<void> {
  try {
    const appBaseUrl = resolveAppBaseUrl(options.appBaseUrl, req);

    if (options.enterpriseConnect) {
      const result = await req.auth0.client.completeInteractiveLogin<unknown>(
        createRouteUrl(req.url, appBaseUrl)
      );
      await options.onCallback!(req, res, {
        idTokenClaims: result.idTokenClaims,
        user: result.user,
        appState: result.appState,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'callback_not_resolved', message: 'onCallback resolved without ending the response' });
      }
      return;
    }

    const { appState } = await req.auth0.client.completeInteractiveLogin<{ returnTo: string } | undefined>(
      createRouteUrl(req.url, appBaseUrl)
    );

    res.redirect(appState?.returnTo ?? appBaseUrl);
  } catch (error) {
    next(sanitizeHandlerError(error));
  }
}
