import {
  analyzeBullet,
  buildSupportIndex,
  type BulletEvidenceMatch,
  type BulletSupportLevel,
  type EvidenceGraphData,
  type StructuredResumeV1,
} from '@career-os/shared';

/**
 * Advisory grounding of every bullet in a structured resume against the user's evidence graph.
 * Pure and deterministic (no LLM, no I/O). It never edits or blocks a bullet: it only reports
 * what is and is not backed by the user's own stored evidence. Numbers/technologies the evidence
 * does not back are surfaced as warnings, never silently passed.
 */
export interface BulletGrounding {
  bulletId: string;
  /** The exact bullet text this result was computed for (the UI compares it to the live text). */
  text: string;
  section: 'education' | 'experience' | 'projects' | 'leadership';
  sectionLabel: string;
  supportLevel: BulletSupportLevel;
  unsupportedNumbers: string[];
  unsupportedTechnologies: string[];
  whyThisBullet: string;
  evidence: BulletEvidenceMatch[];
}

export type BulletGroundingMap = Record<string, BulletGrounding>;

interface BulletRef {
  id: string;
  text: string;
  section: BulletGrounding['section'];
  sectionLabel: string;
}

export function listResumeBullets(resume: StructuredResumeV1): BulletRef[] {
  const out: BulletRef[] = [];
  for (const e of resume.education) {
    for (const b of e.bullets) {
      out.push({
        id: b.id,
        text: b.text,
        section: 'education',
        sectionLabel: e.institution,
      });
    }
  }
  for (const e of resume.experience) {
    for (const b of e.bullets) {
      out.push({
        id: b.id,
        text: b.text,
        section: 'experience',
        sectionLabel: `${e.role} at ${e.organization}`,
      });
    }
  }
  for (const e of resume.projects) {
    for (const b of e.bullets) {
      out.push({ id: b.id, text: b.text, section: 'projects', sectionLabel: e.name });
    }
  }
  for (const e of resume.leadership) {
    for (const b of e.bullets) {
      out.push({
        id: b.id,
        text: b.text,
        section: 'leadership',
        sectionLabel: e.organization,
      });
    }
  }
  return out;
}

export function groundResumeBullets(
  graph: EvidenceGraphData,
  resume: StructuredResumeV1,
): BulletGrounding[] {
  // One support index for the whole resume (it was rebuilt three times per bullet before).
  const index = buildSupportIndex(graph);
  return listResumeBullets(resume)
    .filter((b) => b.text.trim().length > 0)
    .map((b) => {
      const { evidence: found, check } = analyzeBullet(graph, b.text, index);
      return {
        bulletId: b.id,
        text: b.text,
        section: b.section,
        sectionLabel: b.sectionLabel,
        supportLevel: check.supportLevel,
        unsupportedNumbers: check.unsupportedNumbers,
        unsupportedTechnologies: check.unsupportedTechnologies,
        whyThisBullet: found.whyThisBullet,
        evidence: found.matches,
      };
    });
}

export function groundResumeBulletsToMap(
  graph: EvidenceGraphData,
  resume: StructuredResumeV1,
): BulletGroundingMap {
  const map: BulletGroundingMap = {};
  for (const g of groundResumeBullets(graph, resume)) map[g.bulletId] = g;
  return map;
}

/** True when a bullet has any warning the user should look at. */
export function hasGroundingWarning(g: BulletGrounding): boolean {
  return (
    g.unsupportedNumbers.length > 0 ||
    g.unsupportedTechnologies.length > 0 ||
    g.supportLevel === 'NONE' ||
    g.supportLevel === 'LIMITED'
  );
}
