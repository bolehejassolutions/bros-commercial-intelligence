import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/portfolio-current-head-merge-smoke.yml', import.meta.url), 'utf8');

test('five-head integration stays disposable and read-only', () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /fetch-depth: 0/);
  for (const branch of [
    'feat/neon-bci-dev-ledger-20261025',
    'feat/demand-meta-funnel-readonly-20261026',
    'feat/demand-direct-meta-readonly-20261031',
    'feat/content-measurement-gate-20261026',
    'feat/portfolio-hitpay-provider-smoke-20261026',
  ]) assert.ok(workflow.includes(branch), `missing worker head: ${branch}`);
  assert.match(workflow, /MERGE_ATTESTED branch=\$branch sha=\$sha/);
  assert.doesNotMatch(workflow, /\b(?:git push|vercel deploy|neonctl|supabase db push)\b/);
  assert.doesNotMatch(workflow, /\b(?:contents: write|actions: write|id-token: write)\b/);
});

test('five-head integration preserves exact-source and fail-closed test gates', () => {
  // Prevent a passing workflow after the integration step is silently skipped.
  assert.match(workflow, /set -euo pipefail/);
  assert.match(workflow, /git fetch --no-tags origin/);
  assert.match(workflow, /git rev-parse "refs\/remotes\/origin\/\$branch"/);
  assert.match(workflow, /git merge --no-ff --no-edit/);
  assert.match(workflow, /CONFLICT .* integration NOT verified/);
  assert.match(workflow, /exit 1/);

  // Source compatibility requires application tests AND build validation.
  assert.match(workflow, /node --experimental-strip-types --test tests\/\*\.test\.mjs/);
  assert.match(workflow, /node --experimental-strip-types --test tests\/sdk\/\*\.test\.mjs/);
  assert.match(workflow, /npx tsc --noEmit/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /timeout-minutes: 20/);

  // CI cannot acquire write authority or silently turn into a provider run.
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /\b(?:workflow_run|repository_dispatch|schedule):/);
  assert.doesNotMatch(workflow, /\b(?:curl|wget)\s+[^\n]*(?:POST|PUT|PATCH|DELETE)/i);
});
