#!/usr/bin/env node
/**
 * CI gate: every `generate-*.ts` pipeline in packages/ai/src must import a contract validator
 * from `./contract/validate-*-contract`, and that validator module must have its own sibling
 * `.test.ts` file.
 *
 * Before this script existed, AI-grounding coverage here was enforced only by code-review
 * discipline (docs/AI_GROUNDING.md), not a CI gate — and in practice that discipline had already
 * let two validators (validate-email-classification-contract.ts,
 * validate-resume-tailoring-contract.ts) ship with no dedicated test file, exercised only
 * indirectly through their generate-*.ts pipeline's own test suite. This script would have failed
 * on that gap; it exists so a *new* pipeline can't slip through the same way.
 *
 * Deliberately simple and grep-based, matching this repo's existing postbuild-script style (see
 * apps/extension/scripts/verify-production-build.mjs) — it checks that the coverage exists, not
 * what the tests actually assert.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const CONTRACT_IMPORT_PATTERN = /from\s+['"](\.\/contract\/validate-[\w-]+-contract|\.\/contract\/validate-contract)['"]/g;

const generateFiles = readdirSync(SRC_DIR)
  .filter((name) => name.startsWith('generate-') && name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort();

if (generateFiles.length === 0) {
  console.error(
    'check-generation-contract-coverage: no generate-*.ts files found in packages/ai/src — ' +
      'the glob pattern may be stale. Update this script if generation pipelines moved.',
  );
  process.exit(1);
}

const errors = [];

for (const file of generateFiles) {
  const fullPath = join(SRC_DIR, file);
  const content = readFileSync(fullPath, 'utf8');
  const matches = [...content.matchAll(CONTRACT_IMPORT_PATTERN)].map((m) => m[1]);

  if (matches.length === 0) {
    errors.push(
      `${file} imports no contract validator from ./contract/validate-*-contract — every ` +
        `generation pipeline must validate its model response against a Zod contract ` +
        `(docs/AI_GROUNDING.md §4) before persisting or returning it.`,
    );
    continue;
  }

  for (const relativeImport of matches) {
    const validatorPath = join(SRC_DIR, `${relativeImport.replace('./', '')}.ts`);
    const validatorTestPath = join(SRC_DIR, `${relativeImport.replace('./', '')}.test.ts`);
    if (!existsSync(validatorPath)) {
      errors.push(
        `${file} imports "${relativeImport}", but ${validatorPath.slice(dirname(SRC_DIR).length)} ` +
          `does not exist.`,
      );
      continue;
    }
    if (!existsSync(validatorTestPath)) {
      errors.push(
        `${relativeImport.replace('./contract/', '')}.ts (imported by ${file}) has no sibling ` +
          `${relativeImport.split('/').pop()}.test.ts — every contract validator needs its own ` +
          `direct test covering acceptance and rejection, not only indirect coverage through its ` +
          `generate-*.ts pipeline's own tests.`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error('\n❌ AI generation contract coverage check failed:\n');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('');
  process.exit(1);
}

console.log(
  `✅ Contract coverage verified for ${generateFiles.length} generation pipeline${generateFiles.length === 1 ? '' : 's'}.`,
);
