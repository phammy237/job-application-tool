import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { GenericHtmlAdapter } from './generic-html-adapter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string, url: string): Document {
  const html = fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8');
  return new JSDOM(html, { url }).window.document;
}

describe('GenericHtmlAdapter', () => {
  it('always matches, since it is the guaranteed fallback', () => {
    expect(GenericHtmlAdapter.matches('https://example.com/anything', document)).toBe(true);
  });

  it('extracts from schema.org JobPosting JSON-LD when present, preferring it over the DOM', () => {
    const doc = loadFixture('json-ld-job-posting.html', 'https://acme.example/jobs/1');
    const result = GenericHtmlAdapter.extract(doc);

    expect(result.title).toBe('Backend Engineer');
    expect(result.company).toBe('Acme Corp');
    expect(result.location).toBe('Remote, US');
    expect(result.employmentType).toBe('FULL_TIME');
    expect(result.description).toContain('Build and scale our payments platform.');
    expect(result.responsibilities).toEqual([
      'Design and ship backend services',
      'Own the payments pipeline end to end',
    ]);
    expect(result.qualifications).toEqual([
      '5+ years of backend experience',
      'Strong SQL skills',
    ]);
    expect(result.preferredQualifications).toEqual(['Experience with Kubernetes']);
    expect(result.sourceUrl).toBe('https://acme.example/jobs/1');
    expect(result.platformType).toBe('GENERIC');
  });

  it('falls back to <meta> tags when no JobPosting JSON-LD is present', () => {
    const doc = loadFixture('og-title-only.html', 'https://globex.example/careers/2');
    const result = GenericHtmlAdapter.extract(doc);

    expect(result.title).toBe('Frontend Engineer');
    expect(result.company).toBe('Globex Corporation');
    expect(result.description).toBe('Join our frontend team building delightful UIs.');
    expect(result.qualifications).toEqual(['3+ years with React', 'Comfortable with TypeScript']);
  });

  it('falls back to heading + list heuristics when neither JSON-LD nor meta tags are present', () => {
    const doc = loadFixture('heuristic-fallback.html', 'https://smallco.example/jobs/3');
    const result = GenericHtmlAdapter.extract(doc);

    expect(result.title).toBe('Staff Product Designer');
    expect(result.company).toBeNull();
    expect(result.responsibilities).toEqual([
      'Lead design for our core product surfaces',
      'Partner with engineering and product',
    ]);
    expect(result.qualifications).toEqual(['7+ years of product design experience']);
    expect(result.preferredQualifications).toEqual(['Experience in B2B SaaS']);
  });

  it('produces a schema-valid payload even with nothing extractable', () => {
    const doc = new JSDOM('<html><body></body></html>', {
      url: 'https://empty.example/',
    }).window.document;
    const result = GenericHtmlAdapter.extract(doc);

    expect(result.title).toBeNull();
    expect(result.company).toBeNull();
    expect(result.responsibilities).toEqual([]);
    expect(result.sourceUrl).toBe('https://empty.example/');
  });
});
