import { Request, Response } from 'express';
import { toSafeRedirect } from '../utils.js';
import { Auth0Options } from '../index.js';

export async function handleLogin(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const dangerousReturnTo = req.query.returnTo as string | undefined;
    const sanitizedReturnTo = toSafeRedirect(dangerousReturnTo || '/', options.appBaseUrl);

    // Extract authorization parameters from query string
    const authorizationParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.query)) {
      // We exclude 'returnTo' as it's handled separately
      if (key !== 'returnTo') {
        authorizationParams[key] = value;
      }
    }

    const authorizationUrl = await req.auth0.client.startInteractiveLogin({
      pushedAuthorizationRequests: options.pushedAuthorizationRequests,
      appState: { returnTo: sanitizedReturnTo },
      authorizationParams: Object.keys(authorizationParams).length > 0 ? authorizationParams : undefined,
    });

    res.redirect(authorizationUrl.href);
  } catch (error) {
    res.status(500).json({
      error: (error as Error).name,
      message: (error as Error).message,
    });
  }
}
