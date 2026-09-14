# Resume Studio

Phase 7C's design record for the structured résumé content model, deterministic LaTeX
rendering, and the manual editing UI ("Resume Studio," `/resumes/[id]/studio`). See
`docs/DATA_MODEL.md` "resume_versions" for the column-level schema and
`docs/IMPLEMENTATION_PLAN.md` "Phase 7C"/"Phase 7D" for the full as-built writeup.

## 1. Why PDF compilation is not implemented yet

Investigated before writing any renderer code, not assumed:

- No Docker, no `pdflatex`/`xelatex`/`tectonic`/`latexmk`, no LaTeX package of any kind exists
  in this repository or its dependency tree.
- `docs/DEPLOYMENT.md` targets "a Node-compatible host with first-class Next.js support (e.g.
  Vercel)" — an ordinary serverless/edge Node deployment. There is no apt-level package install,
  no persistent filesystem, no pre-existing isolated worker/service, and (on most such hosts) a
  bounded execution time and deployment size that a full TeX Live install would not fit inside
  even if it could be installed.
- No external LaTeX/PDF compilation API is configured anywhere (no API key, no documented
  vendor), and standing one up blind — without the ability to test a real deployment end-to-end
  in this environment — would risk shipping a "PDF compilation" feature that silently doesn't
  work, or worse, an insufficiently sandboxed one (see §9).

Given that, this phase implements the deterministic **structured content → LaTeX** half of the
pipeline completely and defers the **LaTeX → PDF** half explicitly (task option "F": implement
the studio + deterministic `.tex` rendering first, defer compilation, rather than pretend it
works). The Studio's "preview" is the generated LaTeX source itself — clearly labeled, with a
"Download .tex" action so the user can compile it themselves today (e.g. paste into Overleaf).

**What a future phase adding real compilation should evaluate** (not decided here, since none of
the options below could be verified end-to-end in this environment):

- **Tectonic**, run inside an isolated worker/service (a separate container/task the web app
  calls over a private network) — the most promising option: a single self-contained binary
  (bundles its own TeX distribution and fetches packages once, cacheable), no system-wide TeX
  Live install needed. Still needs a real sandboxed host to run in, which does not exist today.
- A client-side WASM LaTeX engine (compiles in the visitor's own browser tab) — sidesteps every
  server-side sandboxing concern entirely, at the cost of a large asset download and unverified
  output fidelity; worth prototyping, not chosen sight-unseen.
- An external compilation API — viable in principle, but introduces a third-party data flow
  (résumé content leaving Career OS's infrastructure) that would need its own privacy review
  first.
- A local/native subprocess (plain `pdflatex`) — explicitly not viable here: no such binary
  exists in this deployment target, and even where one did, shelling out to it with
  user-influenced arguments is the exact anti-pattern §9 warns against.

## 2. Structured content is canonical; LaTeX is a rendering layer

`StructuredResumeV1` (`packages/shared/src/schemas/resume-content.ts`) is what a user actually
edits and what any future AI-tailoring phase will read/diff. `renderStructuredResumeToLatex`
(`packages/shared/src/lib/resume-latex-render.ts`) is a pure function from that structure to
LaTeX text — the same input always produces the same output, and nothing about it is stored:
LaTeX is never written to the database as its own row/column. The one thing genuinely stored
alongside the structured content is an optional **custom LaTeX override** (§6) — an explicit,
user-authored departure from the generated render, which cannot itself be derived from anything
else and so has nowhere else to live.

## 3. Self-describing snapshots, never reinterpreted

`resume_versions.snapshot_format` (already established in Phase 7A) gained one new value,
`STRUCTURED_V1`, alongside the existing `METADATA_ONLY` (migration 0022 — additive, no existing
row's format or payload was touched). The JSON payload itself also carries its own
`schemaVersion: 1` field, independent of that column — so a future `StructuredResumeV2` can be
introduced by adding a new format value and a new schema, without ever having to reinterpret an
existing `STRUCTURED_V1` payload as something it wasn't. Both are database-enforced:
`snapshot_payload` must be null for `METADATA_ONLY` and a non-null JSON object for
`STRUCTURED_V1` (a check constraint), and the Zod schema is a discriminated union on
`snapshotFormat` so the same self-describing rule holds in TypeScript.

## 4. Provenance: MANUAL vs. CANDIDATE_FACTS

A bullet's `provenance` is a discriminated union — `{type: 'MANUAL'}` or `{type:
'CANDIDATE_FACTS', sourceFactIds: [...]}` — never an optional array that could ambiguously mean
either "grounded in zero facts" or "not grounded at all." Manual editing in this phase never
requires a bullet to already trace back to an approved fact; the field exists so importing from
profile (§5) and any future AI-tailoring phase have somewhere honest to record it when they do.

## 5. How a résumé's content is initialized

Never hallucinated. Three paths, in increasing order of substance:

1. **Blank** — an empty document with only the header pre-filled from the user's own `profiles`
   row (name/email/phone/location/links) — reusing already-known real contact facts is not
   fabricating content, it's the same information the user would type into the header anyway.
2. **Import from profile** — an explicit, user-triggered action
   (`buildStructuredResumeFromProfile`, `packages/shared`) that copies already-`userApproved &&
   approvedForApplications` `experiences`/`education`/`projects`/`skills` rows into the draft —
   the same grounding bar every AI/autofill path in this product already uses
   (`docs/AI_GROUNDING.md`), applied here even though no model is called at all. Never
   auto-applied or auto-saved — the user reviews and edits before "Save New Version" persists
   anything. Leadership is never populated this way: there is no structured "leadership" source
   table (only flat `candidate_facts` rows with no organization/role/date shape), and guessing
   that shape would be inventing structure the user never entered.
3. **Based on an existing version** — editing continues from any prior `STRUCTURED_V1` version's
   exact content (loading a version never mutates it — see §7).

A `METADATA_ONLY` (Phase 7A/legacy) version is never treated as a valid starting point — the
Studio says "this resume has no structured version yet" and starts blank instead, rather than
pretending metadata-only content could seed a structured draft.

## 6. Advanced mode and the custom LaTeX override

Structured content remains the factual model even when a custom override is active — setting or
clearing the override never edits the structured fields, and editing the structured fields never
silently clears an active override (the UI requires an explicit "Reset to generated LaTeX"
confirmation). The override is stored as one field *inside* the same `StructuredResumeV1` JSON
payload (`renderOverride: { latex: string } | null`), not a second database column — a version
either renders from structured content (override null) or from the frozen override string
(override set), decided in exactly one place (`getLatexForResumeVersion`).

## 7. Immutability and saving

`resume_versions` rows are immutable (Phase 7A's `reject_immutable_row_mutation` trigger,
unchanged). The Studio never updates a version in place: "Save New Version" always calls
`create_resume_version` (service-role-only RPC, unchanged signature from Phase 7A — it already
accepted `p_snapshot_format`/`p_snapshot_payload`) to atomically create the *next* version, with
`version_number` computed server-side under a row lock, never client-supplied. Unsaved edits are
plain React state — closing the tab or navigating away without saving loses them (a
`beforeunload` warning fires while the draft is dirty), and there is deliberately no
`resume_drafts` table or autosave in this phase (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §16: "do
not compromise immutable version semantics for convenience").

## 8. Master/tailored lineage, unchanged

Master and tailored résumés each have their own independent version sequence (Phase 7A/7B,
unaffected by this phase). The Studio edits whichever logical résumé (`resumeId`) its route
addresses; it has no special-cased master-vs-tailored behavior beyond that.

## 9. What a real compilation phase must not do

Recorded here so it isn't skipped later: no `exec(`pdflatex ${userInput}`)` or equivalent shell
interpolation; shell-escape disabled; an isolated, ephemeral working directory per compile with
no host filesystem traversal and no `\input`/`\include` reaching outside that one generated file;
a hard execution timeout; source-size and output-size limits; guaranteed temp-file cleanup even
on failure; and no unrestricted network access during compilation. Regex sanitization of
arbitrary custom LaTeX is not an acceptable substitute for real sandboxing (docs/
IMPLEMENTATION_PLAN.md "Phase 7C" §36) — if a real sandbox isn't ready, compiling the custom
override specifically should stay disabled even after the generated-LaTeX path gets one.

## 10. Storage

No Supabase Storage bucket exists for résumés (none did before this phase, and none was created
by it — there is no PDF or other binary artifact to store yet). When a real compilation phase
adds one: private bucket only, paths scoped by `{user_id}/{resume_id}/{resume_version_id}/...`
(never a mutable `latest.pdf`-style path for a historical artifact), signed/authenticated
retrieval only, never a public URL.

## 11. Explicitly not in this phase

No AI (no tailoring, no bullet rewriting, no ATS optimization, no job matching) — every action a
user takes in the Studio is manual. No company research, no web scraping. No PDF compilation
(§1). No résumé-content diffing between versions beyond what a human can already see by opening
two versions side by side.
