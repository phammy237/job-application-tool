#!/usr/bin/env node
/**
 * Postbuild hardening for CRXJS's auto-generated `web_accessible_resources` entries.
 *
 * CRXJS's build step injects its own `web_accessible_resources` entry so the dynamically-injected
 * content/autofill script chunks (loaded via `chrome.scripting.executeScript` from the background
 * worker — this extension declares no static `content_scripts`) can actually be fetched as ES
 * module imports at runtime. It writes a "matches" pattern covering any http(s) origin, with
 * `use_dynamic_url: false` by default — there is no `manifest.config.ts` hook to change this, since
 * CRXJS generates the entry itself during the build, not from anything authored there.
 *
 * The broad `matches` is a necessary consequence of this product's own design (the extension must
 * work on arbitrary employer/ATS job-posting domains, never a fixed allowlist, and declares no
 * `host_permissions` to match CLAUDE.md's frozen permission set) — narrowing it would break real
 * job postings. `use_dynamic_url: false` is not necessary, though: every site a user ever visits
 * can otherwise fetch these exact bundled JS files by their static, predictable path
 * (`chrome-extension://<known-id>/assets/<file>.js`) and inspect this extension's own code, with no
 * user action involved. `use_dynamic_url: true` replaces that stable path with a per-install random
 * UUID segment Chrome generates at runtime, so a page can no longer guess or enumerate it.
 *
 * This runs between `vite build` and `verify-production-build.mjs` — see that script's own
 * manifest-invariant check, which asserts this patch actually took effect.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MANIFEST_PATH = fileURLToPath(new URL('../dist/manifest.json', import.meta.url));

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const resources = manifest.web_accessible_resources;

if (!Array.isArray(resources) || resources.length === 0) {
  console.error(
    'harden-web-accessible-resources: no web_accessible_resources entries found in ' +
      'dist/manifest.json — CRXJS may have changed how it generates this section; update this ' +
      'script (and verify-production-build.mjs\'s matching check) to match.',
  );
  process.exit(1);
}

for (const entry of resources) {
  entry.use_dynamic_url = true;
}

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `✅ Hardened ${resources.length} web_accessible_resources entr${resources.length === 1 ? 'y' : 'ies'} with use_dynamic_url: true.`,
);
