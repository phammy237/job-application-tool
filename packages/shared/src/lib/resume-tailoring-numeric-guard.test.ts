import { describe, expect, it } from 'vitest';
import { extractNumericClaims, findUngroundedNumericClaims } from './resume-tailoring-numeric-guard';

describe('extractNumericClaims', () => {
  it('extracts a percentage', () => {
    expect(extractNumericClaims('Improved throughput by 70%')).toEqual([
      { raw: '70%', normalized: 70, category: 'PERCENT' },
    ]);
  });

  it('extracts a dollar amount with a k suffix', () => {
    const [claim] = extractNumericClaims('Saved $50k annually');
    expect(claim).toMatchObject({ normalized: 50_000, category: 'CURRENCY' });
  });

  it('extracts a bare count with a K suffix (no $)', () => {
    const [claim] = extractNumericClaims('Supported 50K records');
    expect(claim).toMatchObject({ normalized: 50_000, category: 'COUNT' });
  });

  it('extracts a decimal million currency value', () => {
    const [claim] = extractNumericClaims('Managed a $1.2M budget');
    expect(claim).toMatchObject({ normalized: 1_200_000, category: 'CURRENCY' });
  });

  it('extracts a plain integer as COUNT', () => {
    const [claim] = extractNumericClaims('Led a team of 12 engineers');
    expect(claim).toMatchObject({ normalized: 12, category: 'COUNT' });
  });

  it('extracts a growth factor ("10x") as its own category', () => {
    const [claim] = extractNumericClaims('Grew revenue 10x');
    expect(claim).toMatchObject({ normalized: 10, category: 'FACTOR' });
  });

  it('extracts a "+" suffixed count without changing its normalized value', () => {
    const [claim] = extractNumericClaims('Built 10+ APIs');
    expect(claim).toMatchObject({ normalized: 10, category: 'COUNT' });
  });

  it('treats each end of a numeric range as its own claim', () => {
    const claims = extractNumericClaims('Reduced latency by 50-100ms');
    expect(claims.map((c) => c.normalized)).toEqual([50, 100]);
  });

  it('excludes a bare 4-digit year with no unit marker', () => {
    expect(extractNumericClaims('Employed since 2021')).toEqual([]);
  });

  it('does not exclude a percentage that happens to look like a year', () => {
    const claims = extractNumericClaims('Improved conversion by 2021%');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ category: 'PERCENT', normalized: 2021 });
  });

  it('extracts nothing from text with no numbers', () => {
    expect(extractNumericClaims('Built the referral workflow')).toEqual([]);
  });
});

describe('findUngroundedNumericClaims', () => {
  it('accepts a proposal introducing no numbers at all', () => {
    expect(findUngroundedNumericClaims('Improved referral workflow', [])).toEqual([]);
  });

  it('rejects a proposal introducing a percentage absent from all evidence', () => {
    const result = findUngroundedNumericClaims(
      'Improved referral workflow by 70%',
      ['Improved referral workflow'],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.raw).toBe('70%');
  });

  it('accepts a percentage that is present in the original bullet text', () => {
    const result = findUngroundedNumericClaims(
      'Improved referral workflow by 70%',
      ['Improved referral workflow by 70% over two quarters'],
    );
    expect(result).toEqual([]);
  });

  it('accepts a percentage present only in a cited fact', () => {
    const result = findUngroundedNumericClaims(
      'Improved referral workflow by 70%',
      ['Referral program grew conversion by 70% in Q3'],
    );
    expect(result).toEqual([]);
  });

  it('rejects a dollar value absent from evidence', () => {
    const result = findUngroundedNumericClaims('Saved $50k annually', ['Saved money annually']);
    expect(result).toHaveLength(1);
  });

  it('accepts a dollar value present in evidence written with the same notation', () => {
    const result = findUngroundedNumericClaims('Saved $50k annually', ['Saved $50k annually']);
    expect(result).toEqual([]);
  });

  it('rejects a count that was inflated relative to evidence (10+ -> 100+)', () => {
    const result = findUngroundedNumericClaims('Built 100+ APIs', ['Built 10+ APIs']);
    expect(result).toHaveLength(1);
    expect(result[0]?.normalized).toBe(100);
  });

  it('accepts an unchanged count matching evidence exactly', () => {
    const result = findUngroundedNumericClaims('Built 10+ APIs', ['Built 10+ APIs']);
    expect(result).toEqual([]);
  });

  it('never flags an unchanged calendar year mentioned in the bullet', () => {
    const result = findUngroundedNumericClaims(
      'Promoted to Senior Engineer in 2023',
      ['Promoted to Senior Engineer in 2023'],
    );
    expect(result).toEqual([]);
  });

  it('rejects a decimal value not present in evidence', () => {
    const result = findUngroundedNumericClaims(
      'Improved accuracy to 99.9%',
      ['Improved accuracy to 95%'],
    );
    expect(result).toHaveLength(1);
  });

  it('accepts a decimal value present in evidence', () => {
    const result = findUngroundedNumericClaims(
      'Improved accuracy to 99.9%',
      ['Improved accuracy to 99.9%'],
    );
    expect(result).toEqual([]);
  });

  it('rejects a claim within a numeric range where one endpoint is unsupported', () => {
    const result = findUngroundedNumericClaims(
      'Reduced latency by 50-200ms',
      ['Reduced latency by 50-100ms'],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.normalized).toBe(200);
  });

  it('does not cross-ground a percentage against a numerically-equal bare count', () => {
    const result = findUngroundedNumericClaims('Improved conversion by 50%', ['Managed 50 users']);
    expect(result).toHaveLength(1);
  });

  it('is grounded across multiple evidence texts combined', () => {
    const result = findUngroundedNumericClaims('Cut costs by 30% and served 1000 users', [
      'Cut costs by 30% company-wide',
      'Platform served 1000 users at peak',
    ]);
    expect(result).toEqual([]);
  });
});
