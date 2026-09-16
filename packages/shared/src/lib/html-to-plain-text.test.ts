import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './html-to-plain-text';

describe('htmlToPlainText', () => {
  it('strips tags and decodes entities', () => {
    expect(htmlToPlainText('<h2><strong>About the team</strong></h2><p>We build things &amp; ship.</p>')).toBe(
      'About the team\nWe build things & ship.',
    );
  });

  it('removes script and style blocks entirely, including their content', () => {
    const html = '<p>Real content</p><script>alert("x")</script><style>.a{color:red}</style><p>More</p>';
    const result = htmlToPlainText(html);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('color:red');
    expect(result).toBe('Real content\nMore');
  });

  it('turns list items into separate lines', () => {
    const html = '<ul><li>First</li><li>Second</li><li>Third</li></ul>';
    expect(htmlToPlainText(html)).toBe('First\nSecond\nThird');
  });

  it('collapses internal whitespace within a line', () => {
    expect(htmlToPlainText('<p>Too    much   space</p>')).toBe('Too much space');
  });

  it('collapses more than two consecutive blank lines to one', () => {
    const html = '<p>A</p><br><br><br><br><p>B</p>';
    const result = htmlToPlainText(html);
    expect(result).toBe('A\n\nB');
  });

  it('keeps inline tag text content without the tags', () => {
    expect(htmlToPlainText('<p>Build with <a href="https://x.com">our API</a> today</p>')).toBe(
      'Build with our API today',
    );
  });

  it('is deterministic', () => {
    const html = '<p>Same input</p>';
    expect(htmlToPlainText(html)).toBe(htmlToPlainText(html));
  });

  it('handles empty input', () => {
    expect(htmlToPlainText('')).toBe('');
  });

  it('handles plain text with no tags', () => {
    expect(htmlToPlainText('Just plain text.')).toBe('Just plain text.');
  });
});
