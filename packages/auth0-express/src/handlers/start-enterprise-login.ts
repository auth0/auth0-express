import { Request, Response } from 'express';
import type { StartEnterpriseLoginOptions } from '@auth0/auth0-server-js';

/**
 * Starts an Enterprise Connect login for the email in `options`.
 *
 * The upstream `@auth0/auth0-server-js` client runs WebFinger domain discovery
 * and returns the authorize URL for a federated domain or `null` for a
 * non-federated one (it also degrades transient discovery failures — 429,
 * network errors — to `null` internally, so those never surface here).
 *
 * We intentionally do not swallow errors: any error the client does throw
 * (e.g. misconfiguration, `EnterpriseConnectNotSupportedError`) propagates to
 * the caller so real failures are visible instead of being masked as "not
 * federated".
 *
 * @returns `true` when the domain is federated and the response was redirected
 * to Auth0; `false` when the domain is not federated, so the caller can fall
 * back to its own non-enterprise login.
 */
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
