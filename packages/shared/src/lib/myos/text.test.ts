import { describe, expect, it } from 'vitest';
import {
  containsAllTokens,
  detectCompetencies,
  matchTokensWithRelated,
  normalizeText,
  scoreTextMatch,
  stemLite,
  tokenize,
} from './text';

describe('myos text helpers', () => {
  it('normalizes punctuation and symbol-heavy names', () => {
    expect(normalizeText('Node.js & C++, C#!')).toBe('nodejs cplusplus csharp');
  });

  it('stems conservatively', () => {
    expect(stemLite('projects')).toBe('project');
    expect(stemLite('launched')).toBe('launch');
    expect(stemLite('analysis')).toBe('analysis');
    expect(stemLite('class')).toBe('class');
  });

  it('folds career synonyms into one concept', () => {
    expect(tokenize('PM')).toEqual(tokenize('product manager'));
    expect(tokenize('customer interviews')).toEqual(tokenize('usability'));
    expect(scoreTextMatch('analytics', 'data analysis dashboards').score).toBe(1);
    expect(
      scoreTextMatch('stakeholder alignment', 'cross-functional alignment').score,
    ).toBe(1);
  });

  it('does not treat 5pm as pm, and does not match unrelated text', () => {
    expect(scoreTextMatch('product management', 'meetings at 5pm').score).toBe(0);
    expect(scoreTextMatch('python', 'java developer').matchedTerms).toEqual([]);
  });

  it('returns matched terms and a 0..1 score', () => {
    const m = scoreTextMatch('python data pipelines', 'Built Python pipelines');
    expect(m.matchedTerms).toEqual(expect.arrayContaining(['python', 'pipeline']));
    expect(m.score).toBeGreaterThan(0);
    expect(m.score).toBeLessThanOrEqual(1);
  });

  it('empty query scores 0', () => {
    expect(scoreTextMatch('', 'anything').score).toBe(0);
    expect(scoreTextMatch('the and of', 'anything').score).toBe(0);
  });

  it('never matches an empty or single-letter phrase', () => {
    expect(containsAllTokens('Go and R developer', 'R')).toBe(false);
    expect(containsAllTokens('anything', '')).toBe(false);
  });

  it('detects competencies from job text', () => {
    const c = detectCompetencies(
      'Partner with engineering stakeholders, prioritizing the roadmap',
    );
    expect(c).toContain('CROSS_FUNCTIONAL_COLLABORATION');
    expect(c).toContain('PRIORITIZATION');
    expect(detectCompetencies('We sell shoes')).toEqual([]);
  });

  it('M7: ML, AI, LLM and GenAI are distinct concepts; SQL is not analytics', () => {
    const t = (s: string) => tokenize(s)[0];
    const toks = new Set([t('ML'), t('AI'), t('LLM'), t('GenAI')]);
    expect(toks.size).toBe(4);
    expect(t('machine learning')).toBe(t('ML'));
    expect(t('large language models')).toBe(t('LLMs'));
    expect(t('generative ai')).toBe(t('genai'));
    expect(scoreTextMatch('analytics', 'wrote SQL queries').score).toBe(0);
    expect(scoreTextMatch('LLM', 'machine learning models').score).toBe(0);
  });

  it('M7: related concepts are opt-in, half credit, and never an exact concept match', () => {
    const exact = scoreTextMatch('LLM', 'machine learning models');
    expect(exact.relatedConcepts).toEqual([]);
    const rel = scoreTextMatch('LLM', 'machine learning models', { allowRelated: true });
    expect(rel.score).toBe(0.5);
    expect(rel.conceptMatch).toBe(false);
    expect(rel.relatedConcepts).toEqual(['large language models']);
    // asymmetric: a "wanted ML" query has LLM as related, but "SQL" wanted gets no analytics credit
    expect(scoreTextMatch('SQL', 'analytics', { allowRelated: true }).score).toBe(0);
  });

  it('M7: matchTokensWithRelated distinguishes exact from related skill names', () => {
    expect(matchTokensWithRelated('LLM experience', 'LLMs')).toBe('exact');
    expect(matchTokensWithRelated('LLM experience', 'ML')).toBe('related');
    expect(matchTokensWithRelated('ML experience', 'Python')).toBeNull();
    expect(matchTokensWithRelated('data analysis', 'SQL')).toBe('related');
    expect(matchTokensWithRelated('SQL', 'data analysis')).toBeNull();
  });
});
