import { describe, expect, test } from 'vitest';
import { PoppyError, PoppyErrorCode, SessionExpiredError } from '@auth0/auth0-server-js';
import { sanitizeHandlerError, sanitizePoppyHandlerError } from './errors.js';

type ErrorWithStatus = Error & { status?: number; code?: string };

describe('sanitizePoppyHandlerError', () => {
  test('SessionExpiredError gets a fixed text and status 403, with its code, and stays on cause', () => {
    const cause = new SessionExpiredError('detail-3');

    const error = sanitizePoppyHandlerError(cause) as ErrorWithStatus;

    expect(error.message).toBe('The session of this login has already ended.');
    expect(error.status).toBe(403);
    expect(error.code).toBe('session_expired');
    expect(error.cause).toBe(cause);

    // Express writes err.stack into the page outside production, so the stack must be free of the detail as well.
    expect(error.message).not.toContain('detail');
    expect(error.stack).not.toContain('detail');
  });

  // The message of a PoppyError is a fixed text for its code, with no value in it, so it is shown as it is. The reason is
  // for logs and never reaches the page. The code is a fixed string too, so it goes on the error as `error.code`.
  test.each([
    {
      name: 'poppy_sign_in_required',
      code: PoppyErrorCode.SIGN_IN_REQUIRED,
      message:
        "An agent's guest is in this browser, so only a signed-in agent, a new guest join, or the same guest renewing an expired access token can replace it. Log out to sign in as a person.",
    },
    {
      name: 'invalid_poppy_guest',
      code: PoppyErrorCode.INVALID_GUEST,
      message:
        'The ID token looks like the login of a Poppy guest but is not a valid one, so it is neither a guest nor a user.',
    },
    {
      name: 'invalid_poppy_agent',
      code: PoppyErrorCode.INVALID_AGENT,
      message: 'The ID token holds a Poppy Session that is not well formed, so it is neither a signed-in agent nor a user.',
    },
  ])('PoppyError $name gets its own text, status 403 and its code, and stays on cause', ({ code, message }) => {
    const cause = new PoppyError(code, 'reason-detail');

    const error = sanitizePoppyHandlerError(cause) as ErrorWithStatus;

    expect(error.message).toBe(message);
    expect(error.status).toBe(403);
    expect(error.code).toBe(code);
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain('reason-detail');
    expect(error.stack).not.toContain('reason-detail');
  });

  test.each([
    { name: 'an Error', cause: new Error('db down') },
    { name: 'a string', cause: 'boom' },
  ])('$name gets the generic text and status 500, and stays on cause', ({ cause }) => {
    const error = sanitizePoppyHandlerError(cause) as ErrorWithStatus;

    expect(error.message).toBe('Authentication request could not be completed.');
    expect(error.status).toBe(500);
    expect(error.code).toBeUndefined();
    expect(error.cause).toBe(cause);
  });

  test('an error that carries an upstream status still gets status 500', () => {
    // The token endpoint says 400 and the browser still hears 500. finalhandler reads status and statusCode.
    const cause = Object.assign(new Error('upstream'), { status: 400, statusCode: 400 });

    const error = sanitizePoppyHandlerError(cause) as ErrorWithStatus & { statusCode?: number };

    expect(error.status).toBe(500);
    expect(error.statusCode).toBeUndefined();
    expect(error.cause).toBe(cause);
  });
});

describe('sanitizeHandlerError', () => {
  test('still gives a Poppy error status 500, as it does without the poppy option', () => {
    const cause = new PoppyError(PoppyErrorCode.SIGN_IN_REQUIRED, 'x');

    const error = sanitizeHandlerError(cause) as ErrorWithStatus;

    expect(error.status).toBe(500);
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('Authentication request could not be completed.');
    expect(error.cause).toBe(cause);
  });
});
