# supabase

Migrations and seed data for the **Career OS** Supabase project — a project fully separate
from any database used by mypham.space.

- `migrations/` — SQL migrations (tables, indexes, RLS policies). Numbered and applied in
  order; first migration lands in Phase 1.
- `seed.sql` — non-personal demo data only (see `docs/SECURITY_AND_PRIVACY.md`, "Demo data").

See `docs/DATA_MODEL.md` for the full schema this directory implements.
