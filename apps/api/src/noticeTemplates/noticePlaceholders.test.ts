import { describe, expect, it } from 'vitest';
import { findUnknownPlaceholders, parseTemplateBody } from './noticePlaceholders.js';

const VALID_TEMPLATE_BODY = { platform: 'Reddit', name: 'Mine', subject: 'Notice: {{infringing_url}}', body: 'Signed {{ legal_name }} on {{today}}' };

describe('findUnknownPlaceholders', () => {
  it('accepts known names with or without inner spaces and reports each unknown name once', () => {
    expect(findUnknownPlaceholders('{{legal_name}} {{ today }}')).toEqual([]);
    expect(findUnknownPlaceholders('{{legal_nme}} {{legal_nme}} {{ signature }}')).toEqual(['legal_nme', 'signature']);
  });
});

describe('parseTemplateBody', () => {
  it('normalises the platform and trims fields', () => {
    expect(parseTemplateBody(VALID_TEMPLATE_BODY)).toEqual({
      isError: false,
      templateInput: { platform: 'reddit', name: 'Mine', subject: 'Notice: {{infringing_url}}', body: 'Signed {{ legal_name }} on {{today}}' },
    });
  });

  it('rejects unknown platforms, missing fields and unknown placeholders', () => {
    expect(parseTemplateBody({ ...VALID_TEMPLATE_BODY, platform: 'myspace' }).isError).toBe(true);
    expect(parseTemplateBody({ ...VALID_TEMPLATE_BODY, body: '   ' }).isError).toBe(true);
    expect(parseTemplateBody({ ...VALID_TEMPLATE_BODY, subject: 'Hi {{ownr}}' })).toEqual({ isError: true, message: 'Unknown placeholder(s): {{ownr}}' });
  });
});
