const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+/;

/**
 * Parses a `WWW-Authenticate` value holding a single challenge with auth-params,
 * following RFC 9110 sections 11.6.1 and 5.6.4, and throws on anything else. So
 * a quoted-string that a stray `\` or `"` ends early does not parse.
 */
export function parseChallenge(value: string): { scheme: string; params: Array<[string, string]> } {
  let rest = value;

  const fail = (reason: string): never => {
    throw new Error(`${reason} at ${JSON.stringify(rest)} in ${JSON.stringify(value)}`);
  };

  const take = (pattern: RegExp): string | undefined => {
    const match = pattern.exec(rest);
    if (!match) {
      return undefined;
    }
    rest = rest.slice(match[0].length);
    return match[0];
  };

  const need = (pattern: RegExp, reason: string): string => take(pattern) ?? fail(reason);

  const scheme = need(TOKEN, 'expected an auth-scheme');
  const params: Array<[string, string]> = [];

  if (rest === '') {
    return { scheme, params };
  }

  need(/^ +/, 'expected a space after the auth-scheme');

  for (;;) {
    const name = need(TOKEN, 'expected a parameter name');
    need(/^[ \t]*=[ \t]*/, 'expected "="');

    let decoded = '';

    if (take(/^"/) === undefined) {
      decoded = need(TOKEN, 'expected a token or a quoted-string');
    } else {
      for (;;) {
        // qdtext, then quoted-pair, then the closing DQUOTE.
        const text = take(/^[\t !\x23-\x5b\x5d-\x7e\x80-\xff]+/);
        if (text !== undefined) {
          decoded += text;
          continue;
        }

        const pair = take(/^\\[\t \x21-\x7e\x80-\xff]/);
        if (pair !== undefined) {
          decoded += pair.slice(1);
          continue;
        }

        need(/^"/, 'expected the rest of a quoted-string');
        break;
      }
    }

    params.push([name, decoded]);

    if (rest === '') {
      return { scheme, params };
    }

    need(/^[ \t]*,[ \t]*/, 'expected ","');
  }
}
