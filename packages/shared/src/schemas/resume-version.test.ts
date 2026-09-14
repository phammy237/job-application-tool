import { describe, expect, it } from 'vitest';
import { createEmptyStructuredResume } from './resume-content';
import { resumeSnapshotFormatSchema, resumeVersionSchema } from './resume-version';

const BASE = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  resumeId: '33333333-3333-4333-8333-333333333333',
  versionNumber: 1,
  displayName: 'v1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('resumeSnapshotFormatSchema', () => {
  it('accepts METADATA_ONLY and STRUCTURED_V1', () => {
    expect(resumeSnapshotFormatSchema.parse('METADATA_ONLY')).toBe('METADATA_ONLY');
    expect(resumeSnapshotFormatSchema.parse('STRUCTURED_V1')).toBe('STRUCTURED_V1');
  });

  it('rejects an unrecognized format', () => {
    expect(() => resumeSnapshotFormatSchema.parse('LATEX_V1')).toThrow();
  });
});

describe('resumeVersionSchema (discriminated on snapshotFormat)', () => {
  it('parses a METADATA_ONLY version with a null payload', () => {
    const version = resumeVersionSchema.parse({
      ...BASE,
      snapshotFormat: 'METADATA_ONLY',
      snapshotPayload: null,
    });
    expect(version.snapshotFormat).toBe('METADATA_ONLY');
    if (version.snapshotFormat === 'METADATA_ONLY') {
      expect(version.snapshotPayload).toBeNull();
    }
  });

  it('rejects a METADATA_ONLY version with a non-null payload', () => {
    expect(() =>
      resumeVersionSchema.parse({
        ...BASE,
        snapshotFormat: 'METADATA_ONLY',
        snapshotPayload: { schemaVersion: 1 },
      }),
    ).toThrow();
  });

  it('parses a STRUCTURED_V1 version with a valid structured payload', () => {
    const structured = createEmptyStructuredResume({
      fullName: 'Ada Lovelace',
      email: null,
      phone: null,
      location: null,
      links: {},
    });
    const version = resumeVersionSchema.parse({
      ...BASE,
      snapshotFormat: 'STRUCTURED_V1',
      snapshotPayload: structured,
    });
    expect(version.snapshotFormat).toBe('STRUCTURED_V1');
    if (version.snapshotFormat === 'STRUCTURED_V1') {
      expect(version.snapshotPayload.header.fullName).toBe('Ada Lovelace');
    }
  });

  it('rejects a STRUCTURED_V1 version with a null payload', () => {
    expect(() =>
      resumeVersionSchema.parse({
        ...BASE,
        snapshotFormat: 'STRUCTURED_V1',
        snapshotPayload: null,
      }),
    ).toThrow();
  });

  it('rejects a STRUCTURED_V1 version whose payload fails structured validation', () => {
    expect(() =>
      resumeVersionSchema.parse({
        ...BASE,
        snapshotFormat: 'STRUCTURED_V1',
        snapshotPayload: { schemaVersion: 1, header: { fullName: '' } },
      }),
    ).toThrow();
  });
});
