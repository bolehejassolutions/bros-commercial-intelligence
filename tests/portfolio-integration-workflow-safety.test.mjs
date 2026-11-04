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
