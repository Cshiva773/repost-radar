import { describe, expect, it } from 'vitest';
import { parseNoticeText } from './evidencePackRoutes.js';

describe('parseNoticeText', () => {
  it('accepts edited, fully resolved text and trims it', () => {
    expect(parseNoticeText({ noticeText: '  Please remove https://x/1  ' })).toEqual({ isError: false, noticeText: 'Please remove https://x/1' });
  });

  it('rejects text that still holds placeholders, naming each once', () => {
    expect(parseNoticeText({ noticeText: 'Signed {{legal_name}} / {{ legal_name }} on {{today}}' })).toEqual({
      isError: true, message: 'The notice still contains placeholder(s): {{legal_name}}, {{today}}',
    });
  });

  it('rejects empty or missing text', () => {
    expect(parseNoticeText({ noticeText: '   ' }).isError).toBe(true);
    expect(parseNoticeText({}).isError).toBe(true);
  });
});
