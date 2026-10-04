import { describe, expect, it } from 'vitest';
import { TECH_DICTIONARY, findTechnologies, skillAreasFor } from './tech-dictionary';

const names = (text: string): string[] => findTechnologies(text).map((m) => m.canonical);

describe('findTechnologies', () => {
  it('finds common technologies in order of appearance with canonical names', () => {
    expect(names('Built an API with fastapi, postgres and Docker on AWS.')).toEqual([
      'FastAPI',
      'PostgreSQL',
      'Docker',
      'AWS',
    ]);
  });

  it('reports the alias that matched', () => {
    const m = findTechnologies('Uses k8s for deploys')[0]!;
    expect(m).toMatchObject({
      canonical: 'Kubernetes',
      category: 'TOOL',
      matchedAlias: 'k8s',
    });
  });

  it('does not match inside longer words', () => {
    expect(names('Reactive programming with Javascripting and Gopher mascots')).toEqual(
      [],
    );
    expect(names('JavaScript developer')).toEqual(['JavaScript']);
  });

  it('keeps Node.js from also matching JavaScript or .NET aliases', () => {
    expect(names('Runs on Node.js')).toEqual(['Node.js']);
    expect(names('Uses ASP.NET')).toEqual(['ASP.NET']);
  });

  it('does not match Go, R, or C in ordinary English text', () => {
    expect(
      names('Go to the store and let it go. R&D budget, Vitamin C is good.'),
    ).toEqual([]);
    expect(names('I will go ahead; r is a letter; c is too')).toEqual([]);
    expect(names('Go figure')).toEqual([]);
  });

  it('matches Go, R, and C when written as languages', () => {
    expect(names('Backend written in Go')).toEqual(['Go']);
    expect(names('Tools: Python, Go, Rust')).toEqual(
      expect.arrayContaining(['Python', 'Go', 'Rust']),
    );
    expect(names('Statistics in R language')).toEqual(['R']);
    expect(names('Firmware using C and Rust')).toEqual(
      expect.arrayContaining(['C', 'Rust']),
    );
    expect(names('A Golang service')).toEqual(['Go']);
  });

  it('treats C++ and C# as their own tokens, not C', () => {
    expect(names('Engine in C++ with C# tooling')).toEqual(['C++', 'C#']);
  });

  it('requires correct case for ambiguous words', () => {
    expect(names('we express interest and excel at spring cleaning')).toEqual([]);
    expect(names('REST api built with Express')).toEqual(
      expect.arrayContaining(['Express']),
    );
  });

  it('returns each technology once', () => {
    expect(findTechnologies('React, react.js and ReactJS')).toHaveLength(1);
  });

  it('returns nothing for empty text', () => {
    expect(findTechnologies('')).toEqual([]);
  });
});

describe('skillAreasFor', () => {
  it('maps technologies to broader areas', () => {
    expect(skillAreasFor('FastAPI')).toContain('Backend Development');
    expect(skillAreasFor('React')).toEqual(['Frontend Development']);
    expect(skillAreasFor('pytorch')).toEqual(['Machine Learning']);
  });
  it('returns an empty list for unknown technologies', () => {
    expect(skillAreasFor('Nonexistent')).toEqual([]);
  });
});

describe('TECH_DICTIONARY integrity', () => {
  it('has unique canonical names and at least 150 entries', () => {
    const set = new Set(TECH_DICTIONARY.map((e) => e.canonical.toLowerCase()));
    expect(set.size).toBe(TECH_DICTIONARY.length);
    expect(TECH_DICTIONARY.length).toBeGreaterThanOrEqual(150);
  });
  it('resolves every canonical name from its own canonical text (where unambiguous)', () => {
    for (const e of TECH_DICTIONARY) {
      if (e.strictAliases?.includes(e.canonical)) continue;
      expect(names(`We use ${e.canonical} here`), e.canonical).toContain(e.canonical);
    }
  });
});
