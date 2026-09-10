import { Request, Response } from 'express';
import { resolveAppBaseUrl } from '../app-base-url.js';
import { Auth0Options } from '../types.js';

export async function handleLogout(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const returnTo = resolveAppBaseUrl(options.appBaseUrl, req);
    const federatedParam = req.query.federated;
    if (options.enterpriseConnect && federatedParam === 'false') {
      console.warn(
        '[Auth0] Enterprise Connect: logout() called with federated=false. ' +
          'The enterprise IdP session will remain active; the user may silently re-authenticate on the next login.'
      );
    }
    const federated =
      options.enterpriseConnect || federatedParam === 'true'
        ? { federated: true as const }
        : {};

    const logoutUrl = await req.auth0.client.logout({ returnTo, ...federated });

    res.redirect(logoutUrl.href);
  } catch (error) {
    res.status(500).json({
      error: (error as Error).name,
      message: (error as Error).message,
    });
  }
}
