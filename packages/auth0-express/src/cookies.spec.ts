import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { cookieJar, humanIdToken, poppyApp, poppyTenant, setCookieLines } from './test-utils/poppy.js';
import { serve } from './test-utils/serve.js';

// What the cookies of an app that does not use Poppy look like on the wire, for a login, its callback and a logout.
// The `poppy` option must change nothing for such an app, so the headers are pinned here, attribute by attribute.
//
// One thing differs from the SDK before Poppy: the header that clears a cookie of the state store (or of the anonymous
// store) now carries `HttpOnly`, `Secure` and `SameSite`, the same as the header that set it. A browser ignores a header
// that clears a `__Host-` or `__Secure-` cookie unless it has `Secure`, so a clear without it can leave the cookie behind.
// The default session cookie, `__a0_session`, has a plain name, so for an app that keeps it the change only makes the
// header match the one that set the cookie. It matters to an app that gives the cookie a prefixed name. The transaction
// cookie is cleared as before.

const tenant = poppyTenant();

beforeAll(() => tenant.server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => tenant.server.close());

/** A `Set-Cookie` line with the value, the date and the age taken out, so that the test compares the attributes. */
function shape(line: string): string {
  const [pair = '', ...attributes] = line.split(';');

  return [
    `${pair.slice(0, pair.indexOf('='))}=<value>`,
    ...attributes.map((attribute) =>
      attribute
        .trim()
        .replace(/^(Expires=).*$/i, '$1<date>')
        .replace(/^(Max-Age=)\d+$/i, '$1<n>')
    ),
  ].join('; ');
}

describe('the cookies of an app without the poppy option', () => {
  test('are set and cleared with the attributes that the cookie was set with', async () => {
    const agent = await serve(poppyApp({ poppy: undefined }));
    const jar = cookieJar();

    const login = await agent.get('/auth/login').set('Cookie', jar.header());
    jar.take(login);
    tenant.setIdToken(await humanIdToken('auth0|ana'));
    const callback = await agent.get('/auth/callback?code=abc').set('Cookie', jar.header());
    jar.take(callback);
    const logout = await agent.get('/auth/logout').set('Cookie', jar.header());

    expect(setCookieLines(login).map(shape)).toEqual([
      '__a0_tx=<value>; Max-Age=<n>; Path=/; Expires=<date>; HttpOnly; SameSite=Lax',
    ]);
    // The order of the lines is not what is pinned, so they are sorted.
    expect(setCookieLines(callback).map(shape).sort()).toEqual(
      [
        // The transaction is spent, and it is cleared as before.
        '__a0_tx=<value>; Path=/; Expires=<date>',
        '__a0_session.0=<value>; Max-Age=<n>; Path=/; Expires=<date>; HttpOnly; Secure; SameSite=Lax',
      ].sort()
    );
    expect(setCookieLines(logout).map(shape)).toEqual([
      '__a0_session.0=<value>; Path=/; Expires=<date>; HttpOnly; Secure; SameSite=Lax',
    ]);

    // A browser applies the clear, and nothing is left.
    expect(jar.names()).toEqual(['__a0_session.0']);
    jar.take(logout);
    expect(jar.names()).toEqual([]);
  });
});
