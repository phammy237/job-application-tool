import type { NodeType } from '@career-os/shared';

export type NodeShape =
  'circle' | 'diamond' | 'square' | 'triangle' | 'hexagon' | 'pill' | 'ring';

export interface TypeStyle {
  label: string;
  plural: string;
  /** Okabe-Ito colour-blind-safe palette; shape + text label always accompany colour. */
  color: string;
  shape: NodeShape;
}

export const NODE_TYPES: readonly NodeType[] = [
  'PROJECT',
  'SKILL',
  'EXPERIENCE',
  'EDUCATION',
  'ACHIEVEMENT',
  'STORY',
  'EVIDENCE',
];

export const TYPE_STYLE: Record<NodeType, TypeStyle> = {
  PROJECT: { label: 'Project', plural: 'Projects', color: '#0072B2', shape: 'circle' },
  SKILL: { label: 'Skill', plural: 'Skills', color: '#E69F00', shape: 'diamond' },
  EXPERIENCE: {
    label: 'Experience',
    plural: 'Experiences',
    color: '#009E73',
    shape: 'square',
  },
  EDUCATION: {
    label: 'Education',
    plural: 'Education',
    color: '#CC79A7',
    shape: 'triangle',
  },
  ACHIEVEMENT: {
    label: 'Achievement',
    plural: 'Achievements',
    color: '#D55E00',
    shape: 'hexagon',
  },
  STORY: { label: 'Story', plural: 'Stories', color: '#56B4E9', shape: 'pill' },
  EVIDENCE: { label: 'Evidence', plural: 'Evidence', color: '#8A8A8A', shape: 'ring' },
};

const f = (n: number): string => String(Math.round(n * 100) / 100);

/** SVG path data for a shape of radius r centred on the origin. */
export function shapePath(shape: NodeShape, r: number): string {
  switch (shape) {
    case 'diamond':
      return `M0 ${f(-r * 1.2)} L${f(r * 1.2)} 0 L0 ${f(r * 1.2)} L${f(-r * 1.2)} 0 Z`;
    case 'square':
      return `M${f(-r)} ${f(-r)} H${f(r)} V${f(r)} H${f(-r)} Z`;
    case 'triangle':
      return `M0 ${f(-r * 1.2)} L${f(r * 1.1)} ${f(r * 0.85)} L${f(-r * 1.1)} ${f(r * 0.85)} Z`;
    case 'hexagon': {
      const pts = [0, 1, 2, 3, 4, 5].map((i) => {
        const a = (Math.PI / 3) * i;
        return `${f(Math.cos(a) * r * 1.1)} ${f(Math.sin(a) * r * 1.1)}`;
      });
      return `M${pts.join(' L')} Z`;
    }
    case 'pill':
      return `M${f(-r * 1.3)} ${f(-r * 0.7)} H${f(r * 1.3)} V${f(r * 0.7)} H${f(-r * 1.3)} Z`;
    case 'ring':
    case 'circle':
    default: {
      const rr = shape === 'ring' ? r * 0.85 : r;
      return `M${f(-rr)} 0 A${f(rr)} ${f(rr)} 0 1 0 ${f(rr)} 0 A${f(rr)} ${f(rr)} 0 1 0 ${f(-rr)} 0 Z`;
    }
  }
}
