import { Request, Response } from 'express';
import { toSafeRedirect } from '../utils.js';
import { Auth0ExpressOptions } from 'src/index.js';

export async function handleLogin(req: Request, res: Response, options: Auth0ExpressOptions): Promise<void> {
  try {
    const dangerousReturnTo = req.query.returnTo as string | undefined;
    const sanitizedReturnTo = toSafeRedirect(dangerousReturnTo || '/', options.appBaseUrl);

    const authorizationUrl = await req.auth0.client.startInteractiveLogin(
      {
        pushedAuthorizationRequests: options.pushedAuthorizationRequests,
        appState: { returnTo: sanitizedReturnTo },
      },
      { request: req, response: res }
    );

    res.redirect(authorizationUrl.href);
  } catch (error) {
    res.status(500).json({
      error: (error as Error).name,
      message: (error as Error).message,
    });
  }
}
