# apps/web

Next.js App Router dashboard — the authenticated Career OS product surface plus the public
`apply.mypham.space` landing page.

**Status:** not yet scaffolded. Build begins in Phase 1. See `docs/IMPLEMENTATION_PLAN.md`.

Routes (planned):

- `/` — public landing page (marketing, login, waitlist/signup)
- `/dashboard` — authenticated home
- `/profile` — structured candidate profile
- `/applications` — application tracker (Kanban + table)
- `/resumes` — résumé management
- `/settings` — account, Gmail, privacy, danger zone

See `docs/ARCHITECTURE.md` for the full app boundary and `docs/DATA_MODEL.md` for the schema
this app reads and writes through `packages/database`.
