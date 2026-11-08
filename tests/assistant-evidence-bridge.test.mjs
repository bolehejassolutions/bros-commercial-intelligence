import assert from 'node:assert/strict';
import test from 'node:test';
import { EvidenceAccessDenied, projectReadOnlyEvidence } from '../lib/bci/assistant-evidence-bridge.ts';

const scope = {
  identityVerifiedByServer: true,
  tenantMembershipVerifiedByServer: true,
  subjectId: 'operator-1', tenantId: 'tenant-A', product: 'demand', scopes: ['evidence:read'],
};
const make = (overrides = {}) => ({
  schemaVersion: 1, evidenceId: 'receipt-1', tenantId: 'tenant-A', product: 'demand',
  category: 'campaign',
  provenance: {
    provider: 'meta_ads', providerObjectId: 'id-123',
    collectedAt: '2026-11-08T10:00:00+08:00',
    observedAt: '2026-11-08T09:59:00+08:00',
    windowStart: '2026-11-07T00:00:00+08:00',
    windowEnd: '2026-11-07T23:59:59+08:00',
    sourceReference: 'provider:meta_ads:receipt-1', completeness: 'partial',
  },
  metrics: { spend_myr: null, impressions: 0, pixel_purchase_events: 10, paid_orders: null },
  observedFacts: ['private customer PII'], internalPayload: { bearerToken: 'SECRET' },
  ...overrides,
});

test('requires independently authenticated tenant membership and read grant', () => {
  const invalid = [
    {...scope, identityVerifiedByServer: false},
    {...scope, tenantMembershipVerifiedByServer: false},
    {...scope, scopes: []},
    {...scope, subjectId: ''},
    {...scope, product: 'sell'},
    {...scope, tenantId: ''},
  ];
  for (const s of invalid) assert.throws(() => projectReadOnlyEvidence(s, [make()]), EvidenceAccessDenied);
});

test('isolates by both tenant and product, even with mixed storage results', () => {
  const results = projectReadOnlyEvidence(scope, [
    make({ evidenceId: 'other-tenant', tenantId: 'tenant-B' }),
    make({ evidenceId: 'other-product', product: 'content' }),
    make(),
  ]);
  assert.deepEqual(results.receipts.map(r => r.evidenceId), ['receipt-1']);
  assert.equal(results.tenantId, 'tenant-A');
  assert.equal(results.product, 'demand');
});

test('distinguishes null unknown from real numeric zero and refuses derived ROAS', () => {
  const result = projectReadOnlyEvidence(scope, [make()]);
  assert.equal(result.receipts[0].metrics.spend_myr, null);
  assert.equal(result.receipts[0].metrics.impressions, 0);
  assert.equal(result.receipts[0].metrics.pixel_purchase_events, 10);
  assert.ok(!('roas' in result.receipts[0].metrics));
  assert.equal(result.result, 'observed_rows');
});

test('never leaks raw payloads, customer text or provider object IDs', () => {
  const s = JSON.stringify(projectReadOnlyEvidence(scope, [make()]));
  for (const secret of ['private customer PII', 'SECRET', 'id-123', 'internalPayload', 'observedFacts']) {
    assert.equal(s.includes(secret), false);
  }
});

test('empty or mismatched rows are NO_ROWS_NOT_ZERO, not zero spend', () => {
  const output = projectReadOnlyEvidence(scope, [make({tenantId: 'tenant-B'})]);
  assert.equal(output.result, 'NO_ROWS_NOT_ZERO');
  assert.deepEqual(output.receipts, []);
  assert.ok(output.limitations.some(x => x.includes('numeric zero')));
});

test('rejects receipts with secret-bearing source references and invalid timestamps', () => {
  const badURL = make({provenance: {...make().provenance, sourceReference: 'https://example.com?token=SECRET'}});
  const badTime = make({provenance: {...make().provenance, collectedAt: 'yesterday'}});
  assert.equal(projectReadOnlyEvidence(scope, [badURL,badTime]).receipts.length, 0);
});

test('rejects impossible or malformed metric values rather than manufacturing zero', () => {
  const rows=[make({metrics:{spend_myr:NaN}}),make({metrics:{clicks:-1}}),make({metrics:{paid_orders:'5'}})];
  assert.equal(projectReadOnlyEvidence(scope,rows).receipts.length,0);
});

test('allowlists metrics and ignores unsupported arbitrary customer attributes', () => {
  const r=projectReadOnlyEvidence(scope,[make({metrics:{spend_myr:12,customer_phone:123,paid_orders:1}})]);
  assert.deepEqual(r.receipts[0].metrics,{spend_myr:12,paid_orders:1});
});

test('caps output size to reduce inadvertent exposure', () => {
  const rows=Array.from({length:70},(_,i)=>make({evidenceId:'receipt-'+i}));
  assert.equal(projectReadOnlyEvidence(scope,rows).receipts.length,20);
});

test('does not mutate input records', () => {
  const row=make(); const text=JSON.stringify(row);
  projectReadOnlyEvidence(scope,[row]); assert.equal(JSON.stringify(row),text);
});
