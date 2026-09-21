-- Career OS — adds jobs.apply_url: the direct official application destination for a job
-- posting (e.g. an ATS "Apply" link), extracted alongside the job description but conceptually
-- distinct from jobs.source_url (the job-description page's own URL). Nullable — absent rather
-- than guessed when no reliable Apply link/JSON-LD was found on the page. No RLS/policy changes
-- needed: jobs' existing four-policy pattern (0001_init.sql) already covers every column.

alter table public.jobs add column apply_url text;
