import { describe, expect, it } from 'vitest';
import { matchCompetencyConcepts } from './competency-registry';

describe('matchCompetencyConcepts', () => {
  it('matches a simple technical concept', () => {
    expect(matchCompetencyConcepts('Strong SQL and Python skills required')).toEqual(
      expect.arrayContaining(['SQL', 'PYTHON']),
    );
  });

  it('matches C++ and C# without boundary issues', () => {
    expect(matchCompetencyConcepts('Experience with C++ and C# a plus')).toEqual(
      expect.arrayContaining(['CPLUSPLUS', 'CSHARP']),
    );
  });

  it('matches product/business concepts', () => {
    const text = 'Own the product roadmap, run experimentation, and manage stakeholder management';
    const matched = matchCompetencyConcepts(text);
    expect(matched).toContain('ROADMAP');
    expect(matched).toContain('EXPERIMENTATION');
    expect(matched).toContain('STAKEHOLDER_MANAGEMENT');
  });

  it('counts a repeated concept only once', () => {
    const text = 'SQL SQL SQL SQL';
    expect(matchCompetencyConcepts(text).filter((c) => c === 'SQL')).toHaveLength(1);
  });

  it('does not false-positive on an unrelated word containing the alias as a substring', () => {
    expect(matchCompetencyConcepts('We use Cython for performance')).not.toContain('PYTHON');
  });

  it('returns an empty array when nothing matches', () => {
    expect(matchCompetencyConcepts('A completely unrelated sentence about weather')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(matchCompetencyConcepts('SQL AND PYTHON')).toEqual(
      expect.arrayContaining(['SQL', 'PYTHON']),
    );
  });
});
