import { describe, expect, it } from 'vitest';
import {
  parseAddEvidence,
  parseApproval,
  parseCreateProject,
  parseTalkingPoints,
  parseUpdateProject,
  parseVisibility,
  splitList,
} from './form-schemas';

const ID = '11111111-1111-4111-8111-111111111111';

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe('parseCreateProject', () => {
  it('requires a name', () => {
    const r = parseCreateProject(fd({ name: '   ' }));
    expect(r.ok).toBe(false);
  });
  it('normalizes empties to null and accepts valid values', () => {
    const r = parseCreateProject(fd({ name: ' Foo ', role: '', url: 'https://x.dev', status: 'ACTIVE' }));
    expect(r).toMatchObject({ ok: true, data: { name: 'Foo', role: null, url: 'https://x.dev', status: 'ACTIVE' } });
  });
  it('rejects non-http urls, bad status and reversed dates', () => {
    expect(parseCreateProject(fd({ name: 'a', url: 'javascript:alert(1)' })).ok).toBe(false);
    expect(parseCreateProject(fd({ name: 'a', status: 'DONE' })).ok).toBe(false);
    const r = parseCreateProject(fd({ name: 'a', startDate: '2025-02-01', endDate: '2025-01-01' }));
    expect(r).toMatchObject({ ok: false });
  });
  it('ignores any client-supplied user id', () => {
    const r = parseCreateProject(fd({ name: 'a', userId: 'evil', user_id: 'evil' }));
    expect(r.ok && 'userId' in r.data).toBe(false);
  });
});

describe('parseUpdateProject', () => {
  it('requires a uuid id and splits collaborators', () => {
    expect(parseUpdateProject(fd({ id: 'nope', name: 'a' })).ok).toBe(false);
    const r = parseUpdateProject(fd({ id: ID, name: 'a', collaborators: 'Ann, Bo\nann' }));
    expect(r).toMatchObject({ ok: true, data: { collaborators: ['Ann', 'Bo'] } });
  });
});

describe('parseApproval', () => {
  it('cannot approve for applications without base approval', () => {
    const r = parseApproval(fd({ id: ID, approvedForApplications: 'on' }));
    expect(r).toMatchObject({ ok: true, data: { userApproved: false, approvedForApplications: false } });
  });
  it('keeps both when both checked', () => {
    const r = parseApproval(fd({ id: ID, userApproved: 'on', approvedForApplications: 'on' }));
    expect(r).toMatchObject({ ok: true, data: { userApproved: true, approvedForApplications: true } });
  });
});

describe('parseVisibility', () => {
  it('only accepts the enum', () => {
    expect(parseVisibility(fd({ id: ID, visibility: 'PUBLIC' })).ok).toBe(true);
    expect(parseVisibility(fd({ id: ID, visibility: 'WORLD' })).ok).toBe(false);
  });
});

describe('parseTalkingPoints', () => {
  it('caps at 20 lines', () => {
    const many = Array.from({ length: 21 }, (_, i) => `point ${i}`).join('\n');
    expect(parseTalkingPoints(fd({ id: ID, talkingPoints: many })).ok).toBe(false);
    expect(parseTalkingPoints(fd({ id: ID, talkingPoints: 'a\n\nb' }))).toMatchObject({
      ok: true,
      data: { talkingPoints: ['a', 'b'] },
    });
  });
});

describe('parseAddEvidence', () => {
  it('needs a note or a link', () => {
    expect(parseAddEvidence(fd({ id: ID, title: 't' })).ok).toBe(false);
    expect(parseAddEvidence(fd({ id: ID, title: 't', excerpt: 'did it' })).ok).toBe(true);
    expect(parseAddEvidence(fd({ id: ID, title: 't', sourceUrl: 'https://a.b' })).ok).toBe(true);
  });
});

describe('splitList', () => {
  it('dedupes case-insensitively and trims', () => {
    expect(splitList(' A, a ,B', true)).toEqual(['A', 'B']);
    expect(splitList(undefined, true)).toEqual([]);
  });
});
