import { Request, Response } from 'express';
import { resolveAppBaseUrl } from '../app-base-url.js';
import { Auth0Options } from '../types.js';

export async function handleLogout(req: Request, res: Response, options: Auth0Options): Promise<void> {
  try {
    const returnTo = resolveAppBaseUrl(options.appBaseUrl, req);
    // In Enterprise Connect mode the mounted route always forces a federated
    // logout so the enterprise IdP session is ended too. In classic mode we
    // forward ?federated=true when the caller asks for it. Any warning about
    // federated=false is emitted by the upstream client.logout(), not here.
    const federated =
      options.enterpriseConnect || req.query.federated === 'true'
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
