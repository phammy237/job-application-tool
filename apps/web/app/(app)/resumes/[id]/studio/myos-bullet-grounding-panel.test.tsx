// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createEmptyStructuredResume } from '@career-os/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { groundResumeBulletsToMap } from '../../../../../lib/myos/bullet-grounding';
import { testGraph } from '../../../../../lib/myos/test-graph';
import { MyosBulletGroundingPanel } from './myos-bullet-grounding-panel';

afterEach(cleanup);

function resume(text: string) {
  const r = createEmptyStructuredResume({
    fullName: 'Ada',
    email: null,
    phone: null,
    location: null,
    links: {},
  });
  r.projects = [
    {
      id: 'p1',
      name: 'Campus Planner',
      role: null,
      url: null,
      dateRange: { start: null, end: null, isPresent: false },
      bullets: [{ id: 'b0', text, provenance: { type: 'MANUAL' } }],
    },
  ];
  return r;
}

describe('MyosBulletGroundingPanel', () => {
  it('shows a visible warning chip for unbacked numbers and technologies', () => {
    const r = resume('Built a scheduling app in React and Kubernetes used by 9000 students');
    const map = groundResumeBulletsToMap(testGraph(), r);
    render(<MyosBulletGroundingPanel draft={r} grounding={map} />);
    expect(screen.getByText(/technology not backed: Kubernetes/)).toBeInTheDocument();
    expect(screen.getByText(/number not backed/)).toBeInTheDocument();
    expect(screen.getByText('Why this bullet?')).toBeInTheDocument();
  });

  it('flags a bullet edited after the check as stale instead of showing old results', () => {
    const checked = resume('Built a scheduling app in React');
    const map = groundResumeBulletsToMap(testGraph(), checked);
    render(<MyosBulletGroundingPanel draft={resume('Built a different thing')} grounding={map} />);
    expect(screen.getByText(/Edited since the last check/)).toBeInTheDocument();
    expect(screen.queryByText('Why this bullet?')).not.toBeInTheDocument();
  });
});
