import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from './decode-html-entities';

describe('decodeHtmlEntities', () => {
  it('decodes basic named entities', () => {
    expect(decodeHtmlEntities('&lt;h2&gt;&lt;strong&gt;Hi&lt;/strong&gt;&lt;/h2&gt;')).toBe(
      '<h2><strong>Hi</strong></h2>',
    );
  });

  it('decodes quotes and ampersands', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry said &quot;hi&quot;')).toBe(
      'Tom & Jerry said "hi"',
    );
  });

  it('decodes numeric character references', () => {
    expect(decodeHtmlEntities('It&#39;s &#x27;great&#x27;')).toBe("It's 'great'");
  });

  it('leaves unrecognized named entities untouched', () => {
    expect(decodeHtmlEntities('&unknownentity;')).toBe('&unknownentity;');
  });

  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('no entities here')).toBe('no entities here');
  });
});
