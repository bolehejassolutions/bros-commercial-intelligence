/**
 * PORTFOLIO_MERGED_WORKER_HEAD_INTEGRITY_20261028_V1
 *
 * Coordinator-owned acceptance of the *actual* worker revisions merged by
 * portfolio-current-head-merge-smoke.yml into its disposable runner.
 *
 * Historical pinned fixtures in other tests are useful regressions but do not
 * prove that latest worker source is what the integration runner exercised.
 * This checks ancestry and byte identity of critical worker-owned modules
 * against the exact remote refs fetched by the merge workflow.
 *
 * No external provider access, database writes, approvals, deployment or
 * verified INTERNAL V1 business outcomes are claimed by this test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const integrationWorkflow = 'Portfolio current-head integration (read-only merge smoke)';
const inDisposableMerge =
  process.env.GITHUB_ACTIONS === 'true' &&
  process.env.GITHUB_WORKFLOW === integrationWorkflow;

const workers = [
  {
    name: 'Neon/BCI',
    branch: 'feat/neon-bci-dev-ledger-20261025',
    paths: ['lib/bci/internal-lineage.ts', 'lib/bci/audit-append-plan.ts'],
  },
  {
    name: 'DEMAND',
    branch: 'feat/demand-meta-funnel-readonly-20261026',
    paths: ['lib/demand/meta-campaign-execution-evidence.ts'],
  },
  {
    name: 'CONTENT',
    branch: 'feat/content-measurement-gate-20261026',
    paths: ['lib/content/buffer-observation.mjs', 'lib/content/source-byte-provider-bridge.mjs'],
  },
  {
    name: 'Coordinator',
    branch: 'feat/portfolio-hitpay-provider-smoke-20261026',
    paths: ['.github/workflows/portfolio-current-head-merge-smoke.yml'],
  },
];

function git(args) {
  return execFileSync('git', args, {
    encoding: 'buffer',
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

for (const worker of workers) {
  test(`disposable merged HEAD contains exact fetched ${worker.name} worker source`,
    {skip: !inDisposableMerge}, () => {
      const ref = `refs/remotes/origin/${worker.branch}`;
      const sha = git(['rev-parse', '--verify', ref]).toString('utf8').trim();
      assert.match(sha, /^[0-9a-f]{40}$/, 'must resolve fetched remote ref');
      assert.doesNotThrow(
        () => git(['merge-base', '--is-ancestor', sha, 'HEAD']),
        `fetched ${worker.name} SHA must be an ancestor of disposable merged HEAD`,
      );
      for (const path of worker.paths) {
        const fromWorker = git(['show', `${sha}:${path}`]);
        const fromMerge = git(['show', `HEAD:${path}`]);
        const checkedOut = readFileSync(path);
        assert.ok(fromWorker.equals(fromMerge),
          `${path}: later merges must not replace worker-owned source`);
        assert.ok(fromWorker.equals(checkedOut),
          `${path}: tested working tree must equal fetched worker source`);
      }
    });
}
