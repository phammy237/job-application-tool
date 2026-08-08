import type { JobExtractionPayload } from '@career-os/shared';

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
    </div>
  );
}
