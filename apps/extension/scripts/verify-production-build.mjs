#!/usr/bin/env node
/**
 * Postbuild safety net for the exact class of bug that shipped a "production" extension build
 * pointed at http://localhost:3003 (a stray apps/extension/.env.local — Vite loads `.env.local`
 * in EVERY mode, including `vite build`'s default `production` mode, so a developer's own local
 * override silently survived into the distributed build with no warning). Fixed at the source by
 * renaming that file to `.env.development.local` (Vite only loads it in `development` mode), but
 * this check exists so any *future* stray env file, wrong `--mode`, or CI misconfiguration that
 * re-introduces the same class of bug fails the build loudly instead of shipping silently — see
 * docs/DEPLOYMENT.md §5.
 *
 * Deliberately dependency-free (runs after `vite build`, before the build is considered done) and
 * deliberately narrow: it only asserts the two things that actually broke production (API base
 * URL, host_permissions) plus the two invariants CLAUDE.md's extension permission discipline
 * already requires — it does not lint or re-check anything vitest/eslint already cover.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));
const EXPECTED_PRODUCTION_ORIGIN = 'https://apply.mypham.space';
const FORBIDDEN_SUBSTRINGS = ['http://localhost', 'https://localhost', '127.0.0.1'];

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const errors = [];

// 1. The built API_BASE_URL must be the real production origin, and must NOT contain any
//    localhost/loopback string — this is the exact bug: a dev-only env override baked into the
//    distributed build.
const jsFiles = listJsFiles(DIST_DIR);
let foundProductionOrigin = false;
for (const file of jsFiles) {
  const content = readFileSync(file, 'utf8');
  if (content.includes(EXPECTED_PRODUCTION_ORIGIN)) foundProductionOrigin = true;
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (content.includes(forbidden)) {
      errors.push(
        `${file} contains "${forbidden}" — this build would point the extension at a ` +
          `non-production origin. Check for a stray apps/extension/.env.local (Vite loads ` +
          `.env.local in every mode); local dev overrides belong in .env.development.local.`,
      );
    }
  }
}
if (!foundProductionOrigin) {
  errors.push(
    `No built file contains "${EXPECTED_PRODUCTION_ORIGIN}" — API_BASE_URL did not resolve to ` +
      `the production default. Check apps/extension/src/lib/api-client.ts and any ` +
      `VITE_CAREER_OS_API_URL override in scope for this build.`,
  );
}

// 2. Manifest invariants (CLAUDE.md "Extension permission discipline" — no host_permissions
//    beyond the frozen set, which does not include any host_permissions entry at all; the
//    production origin must still be reachable via externally_connectable for the token handoff).
const manifest = JSON.parse(readFileSync(join(DIST_DIR, 'manifest.json'), 'utf8'));
if (!Array.isArray(manifest.host_permissions) || manifest.host_permissions.length !== 0) {
  errors.push(
    `manifest.json host_permissions is ${JSON.stringify(manifest.host_permissions)}, expected ` +
      `an empty array — this extension is not supposed to request any host permission (CLAUDE.md).`,
  );
}
const externallyConnectableMatches = manifest.externally_connectable?.matches ?? [];
if (!externallyConnectableMatches.includes(`${EXPECTED_PRODUCTION_ORIGIN}/*`)) {
  errors.push(
    `manifest.json externally_connectable.matches is missing "${EXPECTED_PRODUCTION_ORIGIN}/*" ` +
      `— the /extension-connect token handoff would not reach this build.`,
  );
}
if (typeof manifest.key !== 'string' || manifest.key.length === 0) {
  errors.push('manifest.json is missing the pinned "key" — the extension ID would not be stable.');
}

if (errors.length > 0) {
  console.error('\n❌ Production build verification failed:\n');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('');
  process.exit(1);
}

console.log(`✅ Production build verified: API base is ${EXPECTED_PRODUCTION_ORIGIN}, manifest host_permissions/externally_connectable/key all correct.`);
