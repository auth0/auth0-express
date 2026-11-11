import type { NextFunction, Request, Response } from 'express';
import type { ServerClient } from '@auth0/auth0-server-js';
import type { StoreOptions } from '../types.js';

/**
 * The paths of the two discovery files of a website with Poppy. Agents ask for them at the root of the domain
 * ({@link https://personalagentprotocol.org/docs/0.3/spec#discovery section 3},
 * {@link https://personalagentprotocol.org/docs/0.3/spec#oauth-server section 3.2} and
 * {@link https://www.rfc-editor.org/rfc/rfc9728#section-3 RFC 9728, section 3}).
 */
export const POPPY_DISCOVERY_PATHS = ['/.well-known/poppy.json', '/.well-known/oauth-protected-resource'];

/**
 * Sends the discovery document that the client has for the path of the request, or calls `next()` for any other path.
 * The answer depends on the path only: the client builds the documents once, from the Poppy config.
 *
 * The response is written with `res.status()`, `res.setHeader()` and `res.end()` only. `res.send()` and `res.json()`
 * would both add `; charset=utf-8` to the `content-type` and an ETag, because `res.json()` calls `res.send()`.
 */
export function handlePoppyDiscovery(
  client: ServerClient<StoreOptions>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const document = client.poppy.getDiscoveryDocument(req.path);

    if (!document) {
      next();
      return;
    }

    res.status(document.status);
    for (const [name, value] of Object.entries(document.headers)) {
      res.setHeader(name, value);
    }
    res.end(document.body);
  };
}
