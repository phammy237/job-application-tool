# myOS

myOS is the **personal evidence layer** of Career OS.

- **myOS** answers: *what have I done, what skills have I demonstrated, what evidence supports
  those claims, and how should that evidence be used?*
- **Career OS** answers: *where should I go next, and how well does my evidence match it?*

The core loop: do something → capture evidence → structure experience → understand skills → match
opportunities → tailor an application → prepare for interviews → do something new.

## Principles

1. **Provenance is non-negotiable.** Everything is `VERIFIED`, `USER_PROVIDED`, `INFERRED` or
   `AI_GENERATED`; inferred suggestions are *candidates* until the user confirms them.
2. **No evidence, no claim.** Gaps are shown explicitly. No metric, role, award or technology is
   ever invented.
3. **Private by default.** `PRIVATE` < `CAREER_OS_ONLY` < `PUBLIC`; nothing leaves Career OS without
   an explicit opt-in.
4. **Deterministic.** No LLM in v1; no AI quota consumed.

## Routes

| Route | Purpose |
| --- | --- |
| `/my` | What does Career OS know about me? Coverage, gaps, onboarding checklist |
| `/my/projects`, `/my/projects/[id]` | Projects as structured evidence containers |
| `/my/skills` | Skills with transparent strength levels and their evidence |
| `/my/timeline` | Chronological view with filters |
| `/my/stories`, `/my/achievements` | STAR story bank, achievements/awards/metrics |
| `/my/graph` | Interactive evidence graph (mobile list fallback) |
| `/my/ask` | Evidence-backed Q&A with citations |
| `/my/github` | Connect, sync, choose repositories to import |
| `/my/settings` | Portfolio export opt-in, API key, export preview |
| Application page | "Evidence match" and "From your evidence" interview prep |
| Resume Studio | "Why this bullet?" grounding per bullet |
| `GET /api/portfolio/v1` | Read-only PUBLIC export for a personal website |

## Docs

- [ARCHITECTURE](./ARCHITECTURE.md) · [EVIDENCE_MODEL](./EVIDENCE_MODEL.md) ·
  [GITHUB_INGESTION](./GITHUB_INGESTION.md) · [PORTFOLIO_API](./PORTFOLIO_API.md) ·
  [CAREER_INTEGRATION](./CAREER_INTEGRATION.md) · [RECONNAISSANCE](./RECONNAISSANCE.md)

## Running

Apply `supabase/migrations/0060_myos_evidence_graph.sql`, then `npm run dev`. GitHub import needs only
a username (public repos); a fine-grained read-only token (stored AES-GCM encrypted via
`TOKEN_ENCRYPTION_KEY`) adds private repositories and verified authorship.
