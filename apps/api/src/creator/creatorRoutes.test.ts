import { describe, expect, it } from 'vitest';
import { parseProfileBody } from './creatorRoutes.js';

describe('parseProfileBody', () => {
  it('requires a name and treats blank optional fields as cleared', () => {
    expect(parseProfileBody({ legalName: 'A' }).isError).toBe(true);
    expect(parseProfileBody({ name: ' Demo ', legalName: '', contactEmail: null })).toEqual({
      isError: false, profileInput: { name: 'Demo', legalName: null, contactEmail: null, mailingAddress: null, timeZone: null, ownAccountList: null },
    });
  });

  it('validates the email and field lengths', () => {
    expect(parseProfileBody({ name: 'Demo', contactEmail: 'not-an-email' }).isError).toBe(true);
    expect(parseProfileBody({ name: 'Demo', mailingAddress: 'x'.repeat(501) }).isError).toBe(true);
    expect(parseProfileBody({ name: 'Demo', contactEmail: 'me@example.com' }).isError).toBe(false);
  });
});

describe('time zone', () => {
  it('accepts IANA zones, keeps the stored one when omitted, and rejects unknown names', () => {
    expect(parseProfileBody({ name: 'Demo', timeZone: 'Asia/Kolkata' })).toMatchObject({ isError: false, profileInput: { timeZone: 'Asia/Kolkata' } });
    expect(parseProfileBody({ name: 'Demo' })).toMatchObject({ isError: false, profileInput: { timeZone: null } });
    expect(parseProfileBody({ name: 'Demo', timeZone: 'Mars/Olympus_Mons' })).toEqual({ isError: true, message: 'Unknown time zone "Mars/Olympus_Mons"' });
  });
});
