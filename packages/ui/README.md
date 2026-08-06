# packages/ui

Shared shadcn/ui-based component library and Tailwind design tokens for the Career OS visual
identity (purple accent, neutral surfaces, status colors). Consumed by `apps/web` and,
where bundle size allows, the extension popup.

**Status:** Phase 1 scaffolded — `tailwind-preset.ts` (purple-accent design tokens + status
colors) and base components (`Button`, `Input`, `Textarea`, `Label`, `Select`, `Card`,
`Badge`, `StatusBadge`), hand-built with `class-variance-authority` + Tailwind rather than the
shadcn CLI (kept dependency-light for Phase 1; shadcn's copy-in components can replace these
one-for-one later without changing call sites, since the styling convention is the same).
