# myOS Portfolio API (read-only)

A clean, versioned data layer that a personal website (e.g. `mypham.space`) can consume later.
Career OS does **not** render the portfolio; it only exposes selected PUBLIC data.

## Privacy model

Three gates must all pass for an item to appear:

1. `portfolio_settings.enabled = true` (default `false`; explicit opt-in).
2. The item's `visibility = 'PUBLIC'` (default `PRIVATE`; `CAREER_OS_ONLY` never leaves).
3. The item is `user_approved = true`.

Never exported in v1: stories, candidates, evidence excerpts/metadata (evidence appears only as
`title` + `url` when itself PUBLIC), private GitHub repository data, any edge touching a non-public
node. Filtering is a pure function (`buildPortfolioExport`) with a fuzz test asserting no non-public
string or id appears anywhere in the serialized output.

## Authentication

A per-user API key (`cos_pub_…`), generated in `/my/settings` (shown once, only its SHA-256 hash is
stored in `portfolio_settings.api_key_hash`). The server derives `user_id` from the hash — never from
a client parameter — then reads with the service-role client **filtering explicitly by that
`user_id`** (CLAUDE.md: service-role paths must independently filter). Rotate to revoke.

Because the key is a bearer secret, the personal site must call Career OS **server-side** and cache;
do not embed the key in browser code.

## Endpoint

`GET /api/portfolio/v1` · header `Authorization: Bearer cos_pub_…` · `Cache-Control: private, max-age=60`

```jsonc
{
  "schemaVersion": "myos.portfolio.v1",
  "generatedAt": "2026-10-04T12:00:00.000Z",
  "profile": { "displayName": "…", "headline": "…" },
  "projects": [{ "id": "…", "name": "…", "summary": "…", "status": "ACTIVE",
                 "startDate": "…", "endDate": null, "url": "…",
                 "skills": ["FastAPI"], "evidence": [{ "title": "…", "url": "…" }] }],
  "skills": [{ "name": "Python", "level": "STRONG" }],
  "achievements": [{ "title": "…", "kind": "AWARD", "occurredOn": "…" }],
  "timeline": [{ "type": "PROJECT", "title": "…", "start": "…", "end": null }]
}
```

Unknown/disabled/rotated keys return `401` with an identical body (no enumeration).

## Consuming from mypham.space

```mermaid
sequenceDiagram
  participant Site as mypham.space (server)
  participant API as apply.mypham.space/api/portfolio/v1
  Site->>API: GET (Bearer key) — at build or ISR revalidate
  API-->>Site: myos.portfolio.v1 JSON (PUBLIC only)
  Site->>Site: render, cache; never store the key client-side
```

This matches CLAUDE.md's sanctioned boundary: a versioned JSON export, never a live database link or
scraped HTML.

## Implementation notes

- **Failures**: every authentication failure (missing/malformed `Authorization`, unknown or rotated
  key, export disabled) returns `401 {"error":"unauthorized"}` with `Cache-Control: no-store`.
  Backend errors return a generic `500 {"error":"internal_error"}`.
- **Rate limiting (best effort)**: an in-memory fixed window of 60 requests/minute per key+IP and 120
  requests/minute per IP returns `429 {"error":"rate_limited"}` with `Retry-After`. State is per
  server instance and resets on cold start, so treat it as abuse dampening, not a guarantee; add an
  edge/WAF limit for hard guarantees.
- **CORS**: no CORS headers are sent; the endpoint is server-to-server only.
- **Scoping**: the user id comes only from the key hash. The service-role reads
  (`loadOwnEvidenceGraph`, `getOwnPortfolioSettings`) are filtered by that id, and the response is
  validated with `portfolioExportSchema`. Query/body/header user ids are ignored.
- **Preview**: `/my/settings` renders the exact `buildPortfolioExport` output for the current graph.
