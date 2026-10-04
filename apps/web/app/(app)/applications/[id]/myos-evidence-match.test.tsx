// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { emptyEvidenceGraph } from '@career-os/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { testGraph } from '../../../../lib/myos/test-graph';
import { MyosEvidenceMatch } from './myos-evidence-match';
import { MyosInterviewPrep } from './myos-interview-prep';

afterEach(cleanup);

describe('MyosEvidenceMatch', () => {
  it('points an empty graph at /my', () => {
    render(
      <MyosEvidenceMatch
        graph={emptyEvidenceGraph()}
        requirements={[{ id: 'r1', text: 'Experience with React', category: 'REQUIRED' }]}
        source="ANALYSIS_RUN"
      />,
    );
    expect(screen.getByText(/evidence graph is empty/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /set up myos/i })).toHaveAttribute(
      'href',
      '/my',
    );
  });

  it('shows supporting project, provenance and an explicit gap row without overselling', () => {
    render(
      <MyosEvidenceMatch
        graph={testGraph()}
        requirements={[
          { id: 'r1', text: 'Experience building scheduling apps', category: 'REQUIRED' },
          { id: 'r2', text: 'Deep Haskell compiler expertise', category: 'REQUIRED' },
        ]}
        source="POSTING_LISTS"
      />,
    );
    expect(
      screen.getAllByText('No meaningful evidence found.', { exact: false }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /add evidence/i })[0]).toHaveAttribute(
      'href',
      '/my/projects',
    );
    expect(screen.getByRole('status')).toHaveTextContent(/fit on recorded evidence/i);
    expect(screen.queryByText(/strong fit/i)).not.toBeInTheDocument();
  });
});

describe('MyosInterviewPrep', () => {
  it('is titled From your evidence and links to the empty state when nothing relates', () => {
    render(
      <MyosInterviewPrep
        graph={emptyEvidenceGraph()}
        job={{ title: 'Engineer', description: 'We build things.' }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'From your evidence' }),
    ).toBeInTheDocument();
  });
});
