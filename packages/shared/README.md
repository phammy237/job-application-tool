# packages/shared

TypeScript types and Zod schemas shared between `apps/web` and `apps/extension`: candidate
fact shapes, job extraction payloads, form-field classifications, generated-answer contracts,
application status enums.

This package has no runtime dependency on Supabase, Claude, or Gmail — it is pure types and
validation so both the dashboard and the extension can trust the same wire contract.

**Status:** not yet scaffolded. First populated in Phase 1 (core domain types) and extended in
Phase 2–3 (extraction and AI-answer contracts). See `docs/DATA_MODEL.md` and
`docs/AI_GROUNDING.md`.
