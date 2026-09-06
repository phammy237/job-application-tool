// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequirementAnalysisPanel } from './requirement-analysis-panel';

const SNAPSHOT_ID = 'snap-1';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const MISSING_MAPPING = {
  id: 'm-missing',
  requirementText: 'PhD in a relevant field',
  requirementCategory: 'EDUCATION',
  requiredOrPreferred: 'REQUIRED',
  relationship: 'MISSING',
  matchedFacts: [],
  explanation: 'Nothing in your approved facts covers this.',
  confidence: 0.4,
  requiresUserConfirmation: true,
};

const INFERRED_MAPPING = {
  id: 'm-inferred',
  requirementText: 'Experience leading a team',
  requirementCategory: 'EXPERIENCE',
  requiredOrPreferred: 'PREFERRED',
  relationship: 'INFERRED',
  matchedFacts: [
    { factId: 'f-1', sourceTable: 'experiences', factUpdatedAt: '2026-01-01T00:00:00.000Z', validity: 'valid' },
  ],
  explanation: 'Your senior title implies leadership.',
  confidence: 0.6,
  requiresUserConfirmation: true,
};

const FOUR_STATES_MAPPING = {
  id: 'm-four-states',
  requirementText: '5+ years backend experience',
  requirementCategory: 'EXPERIENCE',
  requiredOrPreferred: 'REQUIRED',
  relationship: 'DIRECT',
  matchedFacts: [
    { factId: 'f-valid', sourceTable: 'experiences', factUpdatedAt: '2026-01-01T00:00:00.000Z', validity: 'valid' },
    { factId: 'f-changed', sourceTable: 'experiences', factUpdatedAt: '2026-01-01T00:00:00.000Z', validity: 'changed_since_analysis' },
    { factId: 'f-unapproved', sourceTable: 'skills', factUpdatedAt: '2026-01-01T00:00:00.000Z', validity: 'unapproved' },
    { factId: 'f-deleted', sourceTable: 'education', factUpdatedAt: '2026-01-01T00:00:00.000Z', validity: 'deleted' },
  ],
  explanation: 'Matches your Acme backend role.',
  confidence: 0.9,
  requiresUserConfirmation: false,
};

const RUN = { id: 'run-1', status: 'CURRENT' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RequirementAnalysisPanel — empty state', () => {
  it('shows "No requirement analysis yet" and an enabled "Analyze requirements" button when no run exists', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: null, mappings: [] }));
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} />);

    expect(await screen.findByText('No requirement analysis yet.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Analyze requirements' });
    expect(button).toBeEnabled();
  });
});

describe('RequirementAnalysisPanel — analyze / generating state', () => {
  it('disables the button and shows "Analyzing…" while a POST is in flight, then re-enables on completion', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: null, mappings: [] }));
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} />);
    await screen.findByText('No requirement analysis yet.');

    let resolvePost!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => { resolvePost = resolve; }));

    fireEvent.click(screen.getByRole('button', { name: 'Analyze requirements' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled());

    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: RUN, mappings: [FOUR_STATES_MAPPING] }));
    resolvePost({ ok: true, status: 200, json: () => Promise.resolve({ status: 'promoted', runId: 'run-1', mappingCount: 1 }) } as Response);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled());
  });
});

describe('RequirementAnalysisPanel — successful results', () => {
  it('groups REQUIRED before PREFERRED and labels "Regenerate" once a run exists', async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      jsonResponse({
        run: RUN,
        mappings: [INFERRED_MAPPING, FOUR_STATES_MAPPING], // PREFERRED first in the array, REQUIRED second
      }),
    );
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} />);

    expect(await screen.findByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf('Required')).toBeLessThan(headings.indexOf('Preferred'));
    expect(screen.getByText(FOUR_STATES_MAPPING.requirementText)).toBeInTheDocument();
    expect(screen.getByText(INFERRED_MAPPING.requirementText)).toBeInTheDocument();
  });

  it('presents MISSING with a "Not covered" badge and no evidence list', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: RUN, mappings: [MISSING_MAPPING] }));
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} />);

    await screen.findByText(MISSING_MAPPING.requirementText);
    expect(screen.getByText('Not covered')).toBeInTheDocument();
  });

  it('presents INFERRED with a "needs your confirmation" badge', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: RUN, mappings: [INFERRED_MAPPING] }));
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} />);

    await screen.findByText(INFERRED_MAPPING.requirementText);
    expect(screen.getByText('Inferred — needs your confirmation')).toBeInTheDocument();
  });

  it('renders all four evidence-validity states distinctly, never collapsed into one', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: RUN, mappings: [FOUR_STATES_MAPPING] }));
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} />);

    await screen.findByText(FOUR_STATES_MAPPING.requirementText);
    expect(screen.getByText('Currently approved')).toBeInTheDocument();
    expect(screen.getByText('Updated since this analysis — regenerate to refresh')).toBeInTheDocument();
    expect(screen.getByText('No longer approved')).toBeInTheDocument();
    expect(screen.getByText('No longer available')).toBeInTheDocument();
  });
});

describe('RequirementAnalysisPanel — regeneration and failure resilience', () => {
  it('a failed regeneration leaves the prior results on screen and shows an error, rather than clearing them', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: RUN, mappings: [FOUR_STATES_MAPPING] }));
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} />);
    await screen.findByText(FOUR_STATES_MAPPING.requirementText);

    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ status: 'validation_failed' }, 502));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    await screen.findByText('Analysis failed. Try again.');
    // The prior, still-current result must still be visible — a failed regeneration never
    // clears what was already there.
    expect(screen.getByText(FOUR_STATES_MAPPING.requirementText)).toBeInTheDocument();
  });

  it('shows a rate-limited message on 429 without clearing prior results', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: RUN, mappings: [FOUR_STATES_MAPPING] }));
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} />);
    await screen.findByText(FOUR_STATES_MAPPING.requirementText);

    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ error: 'AI request limit reached' }, 429));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    await screen.findByText("You've reached your AI request limit for this period.");
    expect(screen.getByText(FOUR_STATES_MAPPING.requirementText)).toBeInTheDocument();
  });

  it('shows a load error when the initial GET fails', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ error: 'Job snapshot not found' }, 404));
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} />);
    await screen.findByText('Could not load requirement analysis.');
  });
});

describe('RequirementAnalysisPanel — truncation notice', () => {
  it('shows an honest truncation notice when the snapshot was truncated, naming the affected fields', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: null, mappings: [] }));
    render(
      <RequirementAnalysisPanel
        jobSnapshotId={SNAPSHOT_ID}
        contentTruncated={true}
        truncatedFields={['description', 'skills']}
      />,
    );
    await waitFor(() => {
      const notice = screen.getByText((_, element) =>
        element?.tagName === 'P' && /too long to store in full/.test(element.textContent ?? ''),
      );
      expect(notice.textContent).toContain('description, skills');
    });
  });

  it('shows no truncation notice when the snapshot was not truncated', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ run: null, mappings: [] }));
    render(<RequirementAnalysisPanel jobSnapshotId={SNAPSHOT_ID} contentTruncated={false} />);
    await screen.findByText('No requirement analysis yet.');
    expect(screen.queryByText(/too long to store in full/)).not.toBeInTheDocument();
  });
});
