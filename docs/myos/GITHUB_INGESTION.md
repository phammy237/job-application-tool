# myOS — GitHub Ingestion

Server-only pipeline in `packages/myos/src/github/*`, exposed through
`apps/web/app/api/myos/github/*`. It reads repository facts from GitHub and writes
provenance-bearing evidence; it never derives skills (a separate extraction component does) and
never auto-approves anything.

## Security posture

- A personal access token is **optional**. Without one only public repositories are visible
  (`/users/{login}/repos`). With one, `/user/repos?affiliation=owner` also returns private repos,
  filtered to the configured login.
- The token is validated once (`GET /user`, must match the claimed login), AES-256-GCM encrypted
  (`TOKEN_ENCRYPTION_KEY`) and stored in `github_credentials` through the **service-role** client
  (that table has RLS enabled with no policies). It is never echoed, logged, serialized
  (`GithubClient.toJSON` omits it) or included in error messages (errors carry fixed text + path).
- The client never follows a pagination URL outside `https://api.github.com`, and sends every
  request with `redirect: 'manual'`: a 3xx is an error unless its `Location` is on
  `https://api.github.com` (then followed manually, max 3 hops), so the bearer token cannot be
  redirected to another host. The token lives in an ES `#private` field: it is not an own
  property, so `console.log` / `JSON.stringify` / `Object.keys` never reveal it.
- **Ownership is only proven by a token.** A token-less (username-only) connection cannot prove the
  user owns that GitHub login. In that mode all evidence is `USER_PROVIDED` (never `VERIFIED`), the
  merged-PR sample search (an authorship claim) is skipped, and sync stats carry
  `ownershipVerified: false` / `ownershipNote: 'ownership unverified'`. Only a token validated
  against `GET /user` for that login (`github_connections.has_token`) yields `VERIFIED` evidence.
- All ingestion writes (evidence, repo rows, sync runs, connection outcome) use the service-role
  client with the session `user_id` passed explicitly and filtered in every query; DB triggers
  allow only the service role to write VERIFIED / `GITHUB_*` evidence and `github_repositories`.
  The select route uses the RLS client only for `selected` / `project_id`.
- Text from GitHub is sanitized before it reaches the DB (`packages/myos/src/github/text.ts`):
  NUL stripped, lone surrogates dropped, truncation by code points not UTF-16 units.
- Request bodies are read through a size cap (content-length check, then a streamed read that
  aborts above the cap) before JSON parsing: connect <= 4096 bytes, select <= 256 bytes.
- `user_id` always comes from the verified session (`getCurrentUser`), never the request body.
- Private-repo evidence is always `visibility = PRIVATE`; so is all GitHub evidence by default.
  `upsertOwnEvidenceBySource` never lowers `verification_state` or resets a user-raised visibility.

## Flow

```mermaid
sequenceDiagram
  autonumber
  participant U as User (browser)
  participant R as /api/myos/github/*
  participant S as sync engine (packages/myos)
  participant G as api.github.com
  participant D as Database (RLS + admin for token)

  U->>R: POST connect {login, token?}
  R->>G: GET /user (token only)
  R->>D: upsert connection (has_token unchanged); save encrypted token, then has_token=true (admin); roll back on failure
  U->>R: POST repositories/{id}/select {selected:true}
  R->>D: set selected; create UNAPPROVED PRIVATE project; GITHUB_REPO evidence; REPRESENTS edge
  U->>R: POST sync
  R->>D: latest run RUNNING and < 10 min? then 409; started < 60s ago (10 min token-less)? 429 + Retry-After
  R->>S: syncGithubRepositories(store, client, userId, login)
  S->>D: startSyncRun
  S->>G: list repos (paginated, capped)
  loop each repo (3 in parallel, none started after 45s)
    alt not selected
      S->>D: upsert metadata only (no detail calls)
    else selected and (SYNCED with etag) and pushed_at unchanged
      S-->>S: skip, zero requests
    else selected, needs sync
      S->>G: GET repo (If-None-Match when last sync ok)
      alt 304
        S-->>S: skip
      else 200
        S->>G: languages, readme, contributors, PR count, commit count, merged-PR sample
        S->>D: upsert GITHUB_REPO / GITHUB_README / GITHUB_PR evidence, then snapshot
      end
    end
  end
  S->>D: finishSyncRun (SUCCEEDED / PARTIAL / FAILED + stats)
  R->>D: github_connections status / last_error / last_synced_at
  R-->>U: {runId, status, stats}
```

## Store interface (`GithubSyncStore`)

Implemented by `apps/web/lib/myos-github-store.ts`; user id is bound per call.

| Store method | Database function |
| --- | --- |
| `listRepositories` | `listOwnGithubRepositories` |
| `upsertRepositorySnapshot` | `upsertGithubRepositorySnapshot` |
| `markRepositorySyncError` | `markOwnGithubRepositorySyncError` (row uuid, not numeric GitHub id) |
| `startSyncRun` | `startOwnGithubSyncRun` |
| `finishSyncRun` | `finishOwnGithubSyncRun` |
| `upsertEvidenceBySource` | `upsertOwnEvidenceBySource` (`created` = `createdAt == updatedAt`) |
| `renameRepositoryEvidence` | `renameGithubEvidenceRefs` in the store (admin; re-keys `source_ref`) |

`upsertGithubRepositorySnapshot` writes every column and marks the row `SYNCED`. A listing-only
snapshot therefore carries over previously fetched detail and **clears `etag`**. Rule: `etag` is
only ever set by a detail fetch, so `etag = null` means "metadata only so far" and selecting such a
repo always triggers a real detail sync.

## Behaviors

| Property | How |
| --- | --- |
| Idempotent | Evidence keyed by `(source_type, source_ref)`: `owner/repo`, `owner/repo#N`. Repos keyed by `(user_id, github_repo_id)`. |
| Incremental | Selected repo with `SYNCED` + `etag` + unchanged `pushed_at` is skipped with zero requests. Changed `pushed_at` sends a conditional `GET /repos/{r}`; `304` skips. Unselected repos are re-upserted only if pushed_at/description/stars/archived/private changed. |
| Retryable | Per-repo `try/catch`: failure -> `markRepositorySyncError` (sanitized, <= 200 chars), run `PARTIAL`. Later runs retry `ERROR` repos (and unchanged-but-never-synced) only. |
| Rate limits | Primary exhaustion (`X-RateLimit-Remaining: 0`) -> `RateLimitError(resetAt)`; the run stops, status `PARTIAL`, `stats.rateLimitResetAt` reported. Secondary: short `Retry-After` is slept (injectable), long one stops the run. |
| Retries | Network errors and 5xx: exponential backoff (500ms, 1s), max 3 attempts. |
| Auth failure | `401` aborts the run as `FAILED`. `404`/permission-less `403` is a per-repo error. |
| Huge repos | Never walks history. Repository-wide PR and commit counts use `?per_page=1` and read the `rel="last"` page number from the `Link` header (one request each; empty repo `409` = 0). Evidence sample = one Search API request: at most 30 most recently updated merged PRs authored by the login. Listing capped at 10 pages x 100. Contributors: first page, top 10. README capped at 6000 chars (evidence excerpt <= 2000). |
| Cooldown / quota | Sync route: 429 + `Retry-After` if the previous run started < 60 s ago. Token-less connections: 1 sync per 10 min per user, and a per-process semaphore (1 concurrent token-less sync). Token-less mode shares the server's unauthenticated GitHub quota (60 req/h per IP), so these limits are deliberately tight; the semaphore is per process (serverless instances do not share it), the per-user cooldown is the durable limit. |
| Concurrency / time | Repos are processed 3 at a time. No new repo is started after 45 s elapsed (route `maxDuration` is 60 s): run ends `PARTIAL`, `stats.deferred` counts the rest, and they are picked up next run. `ERROR` / `PENDING` repos are never skipped by the unchanged-`pushed_at` shortcut. |
| Rename | Repos are keyed by `github_repo_id`. When `full_name` changed, evidence `source_ref`s (`old`, `old#N`) are re-keyed to the new name before the upsert, so no duplicates. A target ref that already exists is left alone (unique violation ignored). |
| Selection | Metadata for all repos; README/languages/contributors/PRs only for repos the user selected. |

## Evidence emitted per selected repo (always `PRIVATE`; `VERIFIED` only with a token-validated login, otherwise `USER_PROVIDED`)

- `GITHUB_REPO` `owner/repo`: description, `occurred_at = pushed_at`, metadata (languages, topics, stars, repository-wide PR and commit totals `prCount` / `commitCount`).
- `GITHUB_README` `owner/repo`: first 2000 chars of the README, metadata `readmeSha`.
- `GITHUB_PR` `owner/repo#N`: title, URL, `occurred_at = merged_at`. Only merged PRs **authored by the connected login**, and only when ownership is verified (token). `prCount` / `commitCount` are repository-wide totals (all authors, all PR states), never "your merged PRs".

## Project import

`createProjectFromRepository` (pure) maps a repo to project fields: humanized name, description,
URL, `start_date` = repo creation date, `end_date` null, `origin = GITHUB`, `status` ACTIVE if pushed
within 12 months else COMPLETED, tags from topics, `user_approved = false`,
`approved_for_applications = false`, `visible_on_public_profile = false`, `visibility = PRIVATE`.
The select route creates the project, makes sure the repo evidence exists, and adds an
`EVIDENCE -> PROJECT REPRESENTS` edge (`USER_PROVIDED`). The user must approve the project later.

## Known limits

- The sync mutex (a `RUNNING` run younger than 10 minutes -> 409) is check-then-insert, not atomic.
  A lost race only duplicates API calls; all writes are idempotent. A crashed run stops blocking
  after 10 minutes.
- Search API results are eventually consistent and limited to 30 requests/minute for authenticated
  callers (10 unauthenticated); a limit hit surfaces as `PARTIAL` with a reset time.
- A repo rename is handled by re-keying evidence in the store; if the store omits
  `renameRepositoryEvidence`, a rename yields fresh evidence under the new name (old rows orphaned).
- The token-less semaphore and cooldown cannot stop a determined user from exhausting the shared
  unauthenticated quota across many accounts; connect with a token for real use.
- Disconnecting deletes the connection and token but keeps synced repositories and evidence.
