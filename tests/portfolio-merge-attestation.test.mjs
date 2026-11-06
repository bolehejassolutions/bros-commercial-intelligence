import test from 'node:test';
import assert from 'node:assert/strict';

const BRANCHES = [
  'feat/neon-bci-dev-ledger-20261025',
  'feat/demand-meta-funnel-readonly-20261026',
  'feat/demand-direct-meta-readonly-20261031',
  'feat/content-measurement-gate-20261026',
  'feat/portfolio-hitpay-provider-smoke-20261026',
];

// Parse a completed job's log, not the PR metadata: only fetched runner refs count.
function verifyAttestation(log, expected) {
  if (!expected || Object.keys(expected).length !== BRANCHES.length ||
      BRANCHES.some(branch => !/^[a-f0-9]{40}$/.test(expected[branch] ?? ''))) {
    throw new Error('EXPECTED_HEADS_INCOMPLETE');
  }
  const observed = new Map();
  for (const line of log.split(/\r?\n/)) {
    const match = line.match(/(?:^|\s)MERGE_ATTESTED branch=(\S+) sha=([a-f0-9]{40})(?:\s|$)/);
    if (!match) continue;
    const [, branch, sha] = match;
    if (!BRANCHES.includes(branch) || observed.has(branch)) throw new Error('ATTESTATION_DUPLICATE_OR_UNKNOWN');
    observed.set(branch, sha);
  }
  if (observed.size !== BRANCHES.length) throw new Error('ATTESTATION_INCOMPLETE');
  for (const branch of BRANCHES) {
    if (observed.get(branch) !== expected[branch]) throw new Error('ATTESTATION_HEAD_CHANGED');
  }
  return true;
}

const expected = Object.fromEntries(BRANCHES.map((branch, i) => [branch, String(i + 1).repeat(40)]));
const lines = BRANCHES.map(branch => `MERGE_ATTESTED branch=${branch} sha=${expected[branch]}`);

test('complete exact runner SHA attestation is accepted', () => {
  assert.equal(verifyAttestation(lines.join('\n'), expected), true);
});
test('missing, duplicate, unknown, malformed and stale attestations fail closed', () => {
  const invalid = [
    lines.slice(1).join('\n'),
    [...lines, lines[0]].join('\n'),
    [...lines, `MERGE_ATTESTED branch=unexpected sha=${'f'.repeat(40)}`].join('\n'),
    lines.join('\n').replace(expected[BRANCHES[0]], 'not-a-sha'),
    lines.join('\n').replace(expected[BRANCHES[0]], 'f'.repeat(40)),
  ];
  for (const log of invalid) assert.throws(() => verifyAttestation(log, expected));
  assert.throws(() => verifyAttestation(lines.join('\n'), { ...expected, [BRANCHES[0]]: '' }));
});
