import { describe, expect, it } from 'vitest';
import {
  extractTechnologyTokens,
  findUngroundedTechnologyTokens,
} from './resume-tailoring-technology-guard';

describe('extractTechnologyTokens', () => {
  it('extracts capitalized technology names', () => {
    expect(extractTechnologyTokens('Built services with Python and PostgreSQL')).toEqual(
      new Set(['python', 'postgresql']),
    );
  });

  it('excludes the sentence-initial word even when capitalized', () => {
    expect(extractTechnologyTokens('Built the ETL pipeline')).toEqual(new Set(['etl']));
  });

  it('excludes common résumé action verbs from the stoplist', () => {
    expect(extractTechnologyTokens('Led the migration to Kubernetes')).toEqual(
      new Set(['kubernetes']),
    );
  });

  it('extracts tokens containing dots and pluses (Node.js, C++)', () => {
    expect(extractTechnologyTokens('Used Node.js and C++ extensively')).toEqual(
      new Set(['node.js', 'c++']),
    );
  });

  it('strips trailing sentence punctuation', () => {
    expect(extractTechnologyTokens('Deployed with Docker.')).toEqual(new Set(['docker']));
  });

  it('extracts nothing from an all-lowercase sentence', () => {
    expect(extractTechnologyTokens('built the internal tools')).toEqual(new Set());
  });
});

describe('findUngroundedTechnologyTokens', () => {
  it('allows a technology already present in the cited evidence', () => {
    const result = findUngroundedTechnologyTokens('Built APIs with Python', ['Uses Python and PostgreSQL']);
    expect(result).toEqual([]);
  });

  it('rejects a technology absent from evidence, even if mentioned by the job posting elsewhere', () => {
    // The job snapshot text is deliberately never passed as evidence here — only what's in the
    // base résumé / cited facts counts (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §13/§16).
    const result = findUngroundedTechnologyTokens('Built data pipelines with Snowflake', [
      'Experience with Python and PostgreSQL',
    ]);
    expect(result).toEqual(['snowflake']);
  });

  it('allows preserving a technology already present in the original bullet being rewritten', () => {
    const result = findUngroundedTechnologyTokens('Migrated the warehouse to Snowflake', [
      'Migrated the warehouse to Snowflake for better performance',
    ]);
    expect(result).toEqual([]);
  });

  it('allows a bullet with no technology-like tokens at all', () => {
    expect(findUngroundedTechnologyTokens('Led weekly stand-ups', [])).toEqual([]);
  });

  it('rejects when no evidence is supplied at all', () => {
    expect(findUngroundedTechnologyTokens('Built with Snowflake', [])).toEqual(['snowflake']);
  });

  it('is case-insensitive when comparing against evidence', () => {
    const result = findUngroundedTechnologyTokens('Wrote SQL queries', ['Experience with sql databases']);
    expect(result).toEqual([]);
  });

  it('combines evidence from multiple cited facts', () => {
    const result = findUngroundedTechnologyTokens('Built with React and AWS', [
      'Frontend experience with React',
      'Cloud experience with AWS',
    ]);
    expect(result).toEqual([]);
  });
});
