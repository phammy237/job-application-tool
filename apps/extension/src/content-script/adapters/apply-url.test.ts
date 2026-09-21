import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractApplyUrl } from './apply-url';

function docFromHtml(bodyHtml: string, url: string): Document {
  return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, { url }).window
    .document;
}

describe('extractApplyUrl', () => {
  it('prefers a distinct, plausible JobPosting JSON-LD url over anything on the page', () => {
    const doc = docFromHtml(
      `<a href="/apply/8127182">Apply now</a>`,
      'https://acme.example/careers/backend-engineer',
    );
    const result = extractApplyUrl(
      doc,
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/apply/backend-engineer/9999',
    );
    expect(result).toBe('https://acme.example/careers/apply/backend-engineer/9999');
  });

  it('ignores a JSON-LD url that is identical to sourceUrl (self-referential, not a distinct apply destination) and falls back to a semantic link', () => {
    const doc = docFromHtml(
      `<a href="/apply/8127182">Apply now</a>`,
      'https://acme.example/careers/backend-engineer',
    );
    const result = extractApplyUrl(
      doc,
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/backend-engineer',
    );
    expect(result).toBe('https://acme.example/apply/8127182');
  });

  it('finds a semantic Apply link and normalizes a relative href against the page URL', () => {
    const doc = docFromHtml(
      `<a href="/apply/8127182">Apply for this role</a>`,
      'https://acme.example/careers/backend-engineer',
    );
    const result = extractApplyUrl(
      doc,
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/backend-engineer',
      undefined,
    );
    expect(result).toBe('https://acme.example/apply/8127182');
  });

  it('skips a Google Search decoy link even when it appears first and matches apply text, and keeps looking for a real one', () => {
    const doc = docFromHtml(
      `<a href="https://www.google.com/search?q=apply+acme">Apply</a>
       <a href="/apply/8127182">Apply now</a>`,
      'https://acme.example/careers/backend-engineer',
    );
    const result = extractApplyUrl(
      doc,
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/backend-engineer',
      undefined,
    );
    expect(result).toBe('https://acme.example/apply/8127182');
  });

  it('ignores an Apply link inside <nav>, <header>, or <footer> (site chrome, not the job action)', () => {
    const doc = docFromHtml(
      `<nav><a href="/apply/wrong-nav">Apply now</a></nav>
       <header><a href="/apply/wrong-header">Apply now</a></header>
       <footer><a href="/apply/wrong-footer">Apply now</a></footer>
       <main><a href="/apply/8127182">Apply now</a></main>`,
      'https://acme.example/careers/backend-engineer',
    );
    const result = extractApplyUrl(
      doc,
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/backend-engineer',
      undefined,
    );
    expect(result).toBe('https://acme.example/apply/8127182');
  });

  it('does not match a paragraph that merely mentions "apply" without the control being an apply-shaped control', () => {
    const doc = docFromHtml(
      `<a href="/some-page">Learn how to apply for a visa</a>`,
      'https://acme.example/careers/backend-engineer',
    );
    const result = extractApplyUrl(
      doc,
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/backend-engineer',
      undefined,
    );
    expect(result).toBeNull();
  });

  it('rejects a generic careers/jobs listing destination even if the link text matches', () => {
    const doc = docFromHtml(
      `<a href="/careers">Apply now</a>
       <a href="/jobs?q=engineer">Apply now</a>`,
      'https://acme.example/careers/backend-engineer',
    );
    const result = extractApplyUrl(
      doc,
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/backend-engineer',
      undefined,
    );
    expect(result).toBeNull();
  });

  it('returns null (never a guess) when there is nothing reliable on the page', () => {
    const doc = docFromHtml(`<p>No apply link here.</p>`, 'https://acme.example/careers/1');
    const result = extractApplyUrl(
      doc,
      'https://acme.example/careers/1',
      'https://acme.example/careers/1',
      undefined,
    );
    expect(result).toBeNull();
  });

  it('resolves an employer-owned ATS link discovered from an Apply control', () => {
    const doc = docFromHtml(
      `<a href="https://jobs.ats-vendor.example/acme/backend-engineer/apply">Start application</a>`,
      'https://acme.example/careers/backend-engineer',
    );
    const result = extractApplyUrl(
      doc,
      'https://acme.example/careers/backend-engineer',
      'https://acme.example/careers/backend-engineer',
      undefined,
    );
    expect(result).toBe('https://jobs.ats-vendor.example/acme/backend-engineer/apply');
  });
});
