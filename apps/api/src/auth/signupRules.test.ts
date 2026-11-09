import { describe, expect, it } from 'vitest';
import { displayNameFromEmail, parseSignupBody } from './signupRules.js';

describe('parseSignupBody', () => {
  it('accepts an email, a long enough password and an optional name', () => {
    expect(parseSignupBody({ email: ' Dana@Example.COM ', password: 'a-long-password', displayName: ' Dana ' })).toEqual({
      isError: false, signupInput: { email: 'dana@example.com', password: 'a-long-password', displayName: 'Dana' },
    });
  });

  it('starts the display name from the email when none is given', () => {
    expect(parseSignupBody({ email: 'dana.example@mail.com', password: 'a-long-password' })).toMatchObject({ signupInput: { displayName: 'dana.example' } });
    expect(displayNameFromEmail('@nobody.com')).toBe('Creator');
  });

  it('refuses a bad email, a short password or a long name', () => {
    expect(parseSignupBody({ email: 'dana', password: 'a-long-password' }).isError).toBe(true);
    expect(parseSignupBody({ email: 'dana@example.com', password: 'short' }).isError).toBe(true);
    expect(parseSignupBody({ email: 'dana@example.com', password: 'a-long-password', displayName: 'x'.repeat(121) }).isError).toBe(true);
    expect(parseSignupBody(undefined).isError).toBe(true);
  });

  it('does not trim the password', () => {
    expect(parseSignupBody({ email: 'dana@example.com', password: '  spaced-password  ' })).toMatchObject({ signupInput: { password: '  spaced-password  ' } });
  });
});
