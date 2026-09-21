import type { JobExtractionPayload } from '@career-os/shared';
import { PRIMARY_BUTTON_STYLE } from '../styles';

/**
 * `applyUrl` (when detected — see content-script/adapters/apply-url.ts) is the direct official
 * application destination, distinct from the analyzed page itself. "Open Application" only ever
 * opens that URL in a new tab (a plain link, same pattern as ApplicationTracker's "Open in
 * Career OS") — it never marks the application APPLIED and never submits anything; the human
 * still does the actual applying on the employer's own site.
 */
export function JobSummary({ job }: { job: JobExtractionPayload }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        {job.title ?? 'Title not detected'}
      </p>
      <p style={{ margin: '2px 0 0', fontSize: 13, color: '#666' }}>
        {job.company ?? 'Company not detected'}
        {job.location ? ` · ${job.location}` : ''}
      </p>
      {job.applyUrl ? (
        <p style={{ margin: '8px 0 0' }}>
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...PRIMARY_BUTTON_STYLE, display: 'inline-block', textDecoration: 'none' }}
          >
            Open Application
          </a>
        </p>
      ) : null}
    </div>
  );
}
