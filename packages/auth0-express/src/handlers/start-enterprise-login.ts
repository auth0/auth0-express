import { Request, Response } from 'express';
import type { StartEnterpriseLoginOptions } from '@auth0/auth0-server-js';

export async function startEnterpriseLogin(
  req: Request,
  res: Response,
  options: StartEnterpriseLoginOptions
): Promise<boolean> {
  const authUrl = await req.auth0.client.startEnterpriseLogin(options);
  if (authUrl) {
    res.redirect(authUrl.href);
    return true;
  }
  return false;
}
