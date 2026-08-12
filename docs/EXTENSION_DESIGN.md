# Extension Design

## 1. Permission model

Manifest V3, requesting the minimum permissions that make the click-triggered workflow work:

```json
{
  "manifest_version": 3,
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": [],
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "background.js" }
}
```

- **`activeTab`** — grants temporary access to the current tab _only after the user invokes
  the extension_ (clicking the toolbar icon or a popup button counts). This is the core
  control that makes "the extension may inspect the DOM only after an explicit action" a
  browser-enforced fact, not a self-imposed rule the code could quietly violate.
- **`scripting`** — lets the background worker inject the content script into the active tab
  on demand, rather than declaring a `content_scripts` match pattern that would run on every
  page load.
- **`storage`** — local storage for the session token and last-analysis cache; no `sync`
  storage, so nothing about the user's activity is propagated via the browser's account sync.
- **No `<all_urls>` or broad `host_permissions`.** The extension does not have standing
  access to any site. If a future feature genuinely needs persistent access to a specific ATS
  domain (e.g. to prefetch), that would be a narrowly-scoped, explicitly justified host
  permission added later — not a default.
- **No `webRequest`, `webNavigation`, `tabs`, `history`, `bookmarks`, `cookies`, or
  `debugger` permissions.** None of these are needed for click-triggered DOM analysis, and
  each would materially widen what the extension could theoretically observe.

### 1a. Manifest fields beyond the permission set (added Phase 2)

Two additional manifest fields exist beyond the `permissions`/`host_permissions` list above.
Neither is a Chrome _permission_ — neither grants the extension any new ability to read page
content, DOM state, or browser data it couldn't already reach — but per this document's own
posture on manifest changes, both are documented here with their justification rather than
added silently:

- **`externally_connectable`** — `{ "matches": ["https://apply.mypham.space/*"] }` (plus
  `http://localhost/*` for local dev — a match pattern with no explicit port matches any port
  on that host, so the dev server isn't pinned to a specific port). Whitelists which page
  origins may open a
  `chrome.runtime.sendMessage`/`connect` channel to this extension's background worker — used
  exactly once, for the one-time auth-token handoff in §4: the Career OS web app's
  `/extension-connect` page sends the newly-minted token to the extension after login, instead
  of requiring the user to copy/paste it. Only the Career OS origin is whitelisted; no other
  page can reach this channel. The background worker additionally validates the message's shape
  strictly (`isExternalTokenHandoffMessage`) before writing anything to storage, rather than
  trusting the origin whitelist alone.
- **`key`** — a public RSA key (not secret) that pins the extension's ID to a stable value
  across dev rebuilds/checkouts. Without it, loading the extension unpacked generates a new
  random ID every time, which would break `/extension-connect`'s
  `sendMessage(EXTENSION_ID, ...)` targeting. A real Chrome Web Store listing gets its own
  key/ID at publish time, at which point this dev key stops mattering.

## 2. What the extension explicitly does not do

- No screen recording or screenshot capture of arbitrary pages.
- No keystroke logging.
- No browsing history collection.
- No background/idle monitoring of tabs the user hasn't invoked the extension on.
- No capture of password fields, payment fields, or other `AUTHENTICATION`-classified fields
  (see §4) — these are excluded from extraction entirely, not extracted-then-discarded.
- No automatic form submission, ever. The extension's furthest action is filling
  user-approved field values; the submit click is always the human's.

## 3. Runtime flow

```
User clicks extension icon
        │
        ▼
Popup opens → shows "Not analyzed yet" + [Analyze Job]
        │  (user clicks Analyze Job)
        ▼
Background service worker injects content script into the active tab (scripting.executeScript)
        │
        ▼
Content script runs adapter chain against the live DOM (read-only)
        │
        ▼
Extraction payload validated against packages/shared Zod schema
        │
        ▼
Popup calls authenticated Career OS API (POST /api/jobs/analyze) with the payload + session token
        │
        ▼
Backend: ranks approved facts, calls Claude, validates response, returns suggestions
        │
        ▼
Popup renders suggestions with per-field edit/approve/skip controls
        │  (user clicks Autofill Approved Fields — optional, and any point from here on)
        ▼
Content script writes only approved values into matching DOM fields (no submit)
        │  (user clicks Save Application — before, during, or after autofill; repeatable)
        ▼
Popup calls POST /api/applications (creates or updates the tracked application as SAVED or
IN_PROGRESS — never APPLIED here) — see docs/DATA_MODEL.md "applications" for the dedup logic
        │  (user submits manually on the employer's own site — outside Career OS entirely)
        │  (user clicks Mark as Applied and confirms, in the popup or the dashboard)
        ▼
Popup calls PATCH /api/applications/:id/mark-applied — the only path that ever sets APPLIED
```

Every arrow crossing from extension → backend carries the user's session token; the backend
re-derives `user_id` from that token server-side (see `docs/SECURITY_AND_PRIVACY.md`) —
the extension never sends a raw `user_id` that the server simply trusts.

## 4. Authentication

- The extension does not implement its own auth UI. On first use, the popup opens the Career
  OS web login in a tab; after login, the web app exchanges the Supabase session for a
  short-lived, extension-scoped token, recorded in `extension_sessions` (hashed) and handed
  back to the extension via a one-time message.
- The extension stores only that token (in `chrome.storage.local`), never a Supabase
  service-role key, Claude key, or Gmail token — those never leave the server.
- Tokens are listable and individually revocable from `/settings`, and expire on a rolling
  window (`extension_sessions.expires_at`), so a stolen laptop doesn't mean permanent access.

## 5. Adapter architecture

```
JobExtractor
 ├── GenericHtmlAdapter        (Phase 2 — always available as fallback)
 ├── GreenhouseAdapter         (Phase 2+ — matched by URL/DOM signature)
 ├── LeverAdapter               (Phase 2+)
 └── WorkdayAdapter             (Phase 2+)
```

- Each adapter implements a common interface: `matches(url, document): boolean` and
  `extract(document): JobExtractionPayload` (the shared Zod-typed shape from
  `packages/shared`).
- The extractor tries platform-specific adapters first (by URL pattern / known DOM markers);
  `GenericHtmlAdapter` is the guaranteed fallback so every page produces a best-effort result
  instead of a dead end.
- `GenericHtmlAdapter` ships first and must work reasonably on arbitrary job pages using
  heading heuristics, `<meta>` tags (e.g. `og:title`, JobPosting JSON-LD if present), and
  visible text block detection — before any platform-specific adapter is built.
- Adapters only ever read the DOM; none of them write to it. Writing (autofill) is a
  separate, later step gated on user approval (§6).

## 6. Form field detection and classification

Fields are located using: `label`, `name`, `id`, `aria-label`, `placeholder`, nearby text
nodes, section headings, input `type`, and `select` option text — a scored heuristic match,
not a single signal.

Each detected field is classified into exactly one of:

`BASIC_PROFILE, EDUCATION, EXPERIENCE, SKILLS, WORK_AUTHORIZATION, RELOCATION,
COMPENSATION, FREE_RESPONSE, FILE_UPLOAD, DEMOGRAPHIC, LEGAL, AUTHENTICATION, UNKNOWN`

### Autofill eligibility by classification

| Classification                                            | Suggestion behavior                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `BASIC_PROFILE` (name, email, phone, LinkedIn, portfolio) | Auto-suggested, pre-checked                                                                                                                |
| `EDUCATION` (school, degree, graduation date)             | Auto-suggested, pre-checked                                                                                                                |
| `EXPERIENCE`                                              | Suggested but **requires explicit approval** — never pre-checked                                                                           |
| `SKILLS`                                                  | Suggested but requires explicit approval                                                                                                   |
| `WORK_AUTHORIZATION`                                      | Suggested but requires explicit approval                                                                                                   |
| `RELOCATION`                                              | Suggested but requires explicit approval                                                                                                   |
| `COMPENSATION`                                            | Suggested but requires explicit approval                                                                                                   |
| `FREE_RESPONSE` (incl. "why this company")                | Suggested but requires explicit approval                                                                                                   |
| `FILE_UPLOAD`                                             | Never auto-attached; user selects the file (e.g. résumé) manually — extension may highlight which résumé version is recommended            |
| `DEMOGRAPHIC`                                             | **Never suggested.** Race/ethnicity, gender, disability, veteran status, medical questions are detected only to be _skipped_, never filled |
| `LEGAL`                                                   | **Never suggested.** Criminal history, legal attestations, digital signatures                                                              |
| `AUTHENTICATION`                                          | **Never touched.** Password/login fields are excluded from extraction entirely                                                             |
| `UNKNOWN`                                                 | Shown to the user as unclassified; never auto-filled                                                                                       |

This table is the enforcement point referenced throughout `docs/PRODUCT_SPEC.md` and
`docs/USER_FLOWS.md`: "requires explicit approval" and "never suggested" are implemented as
different code paths in the popup, not just a UI convention — a field with no proposed value
literally has no approve button to click.

## 7. Popup UI

Sections, top to bottom:

1. **Current-page detection state** — "Not analyzed" / "Analyzing…" / detected platform badge
2. **Analyze Job** button (disabled while analyzing)
3. **Detected company and role**
4. **Proposed field answers** — one row per detected field, grouped by review state (ready /
   needs review / not yet suggested / needs input / already completed / sensitive /
   unsupported — see `packages/shared`'s `field-review.ts`), each with edit / approve / skip
   controls per §6, plus bulk "Suggest all eligible" and "Approve all ready" actions
   (READY-confidence fields only — never a bulk approval for a lower-confidence draft or a
   sensitive/unsupported field). A standalone ranked "job-match summary" /
   "suggested candidate experiences" section, distinct from the per-field list, is not
   currently implemented — deferred, not a documentation error going forward.
5. **Autofill Approved Fields** button — writes only approved values to the page; per-field
   fill results (filled / skipped / failed / stale / unsupported / needs a rescan) render
   inline once available.
6. **Save Application** / **Update Saved Application** button (label reflects whether this
   job is already tracked) — creates or updates the `applications` row as `SAVED` or
   `IN_PROGRESS`; safe to click before, during, or after autofill, and repeatedly (see
   `docs/DATA_MODEL.md` "applications" for the dedup/upsert behavior). Never sets `APPLIED`.
7. **View in Dashboard** link — opens `/applications/:id` on the web app once the job is
   tracked.
8. **Mark as Applied** button — a separate section, gated behind an explicit inline
   confirmation step ("Mark this application as applied?" → Yes/Cancel). The only control
   anywhere in the extension that can set status `APPLIED`; never triggered by filling,
   saving, or any other action.

## 8. Content-script data lifecycle

- Extraction results and suggestions live in the popup's in-memory state and
  `chrome.storage.local` (cleared on tab close or explicit "discard"), not in a background
  page that persists across sites.
- Nothing captured during analysis is sent anywhere except the authenticated Career OS API —
  no third-party analytics SDK ships in the extension bundle.

## 9. Open items for Phase 2 design review

- Exact scoring/threshold for adapter `matches()` platform detection.
- Whether `FILE_UPLOAD` fields should support one-click "attach recommended résumé" via the
  File System Access API, or remain fully manual in v1 (current default: manual).
