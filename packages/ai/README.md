# packages/ai

Server-only Claude integration: deterministic retrieval/ranking of approved candidate facts
against a job description, prompt construction, Zod response validation, and the
unsupported-claims rejection gate. Never imported by client-side code — the Claude API key
must never reach the browser or the extension bundle.

**Status:** implemented (Phase 3). `generateSuggestion` orchestrates the pipeline: structural
refusal for DEMOGRAPHIC/LEGAL/AUTHENTICATION fields, the atomic AI-request rate limit, retrieval
and deterministic ranking (`retrieval/`), prompt construction (`prompt/`), a Claude call with no
`tools` and no thinking (`claude/`), and the two-check rejection gate with one retry
(`contract/`). See `docs/AI_GROUNDING.md`.
