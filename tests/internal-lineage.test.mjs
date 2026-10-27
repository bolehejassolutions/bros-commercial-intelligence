import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBciLineage } from '../lib/bci/internal-lineage.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const scope = { tenantId: A, product: 'demand' };
const stages = ['evidence','signal','case','diagnosis','decision','action','outcome','learning'];
const ids = stages.map((_, i) => `${String(i + 1).padStart(8,'0')}-3333-4333-8333-333333333333`);
const chain = stages.map((stage,i) => ({
  id: ids[i], tenantId: A, product: 'demand', stage,
  sourceSystem: stage === 'evidence' ? 'meta_ads' : 'bci_internal',
  sourceRecordKey: `synthetic-${stage}`,
  recordedAt: `2026-10-25T${String(i).padStart(2,'0')}:00:00Z`,
  parentIds: i ? [ids[i-1]] : [], verification: 'unverified',
}));
const denied = /invalid BCI evidence lineage/i;

test('valid full graph is structural only, not a verified business result', () => {
  const result = validateBciLineage(scope, [...chain].reverse());
  assert.equal(result.structurallyLinkedLearnings, 1);
  assert.equal(result.counts.evidence, 1);
  assert.equal(result.counts.learning, 1);
  assert.equal(result.records[0].verification, 'unverified');
  assert.equal(Object.isFrozen(result.records[0].parentIds), true);
});

test('idempotent exact replay and conflicting ID or provider key rejected', () => {
  assert.equal(validateBciLineage(scope, [...chain, {...chain[0]}]).counts.evidence, 1);
  assert.throws(() => validateBciLineage(scope, [...chain, {...chain[0], verification:'verified'}]), denied);
  assert.throws(() => validateBciLineage(scope, [...chain, {...chain[0], id:'99999999-9999-4999-8999-999999999999'}]), denied);
});

test('cross-tenant, cross-product, orphan and skip-stage links fail closed', () => {
  for (const change of [{tenantId:B},{product:'content'},{parentIds:[B]},{parentIds:[ids[0]]}]) {
    const i = change.parentIds?.[0] === ids[0] ? 2 : 1;
    assert.throws(() => validateBciLineage(scope, chain.map((r,j) => j === i ? {...r,...change} : r)), denied);
  }
});

test('root cannot have parent; derived stages cannot lack parent or duplicate it', () => {
  assert.throws(() => validateBciLineage(scope, [{...chain[0],parentIds:[ids[1]]}]), denied);
  assert.throws(() => validateBciLineage(scope, chain.map((r,i) => i===1?{...r,parentIds:[]}:r)), denied);
  assert.throws(() => validateBciLineage(scope, chain.map((r,i) => i===1?{...r,parentIds:[ids[0],ids[0]]}:r)), denied);
});

test('future parent timestamp, malformed time, and forged verification fail closed', () => {
  assert.throws(() => validateBciLineage(scope, chain.map((r,i)=>i===1?{...r,recordedAt:'2026-10-24T00:00:00Z'}:r)),denied);
  assert.throws(() => validateBciLineage(scope, [{...chain[0],recordedAt:'2026-02-31T00:00:00Z'}]),denied);
  assert.throws(() => validateBciLineage(scope, [{...chain[0],verification:'attested_by_client'}]),denied);
});

test('CONTENT and DEMAND each validate independently, but cannot share private records', () => {
  const content = chain.map(r=>({...r,product:'content'}));
  assert.equal(validateBciLineage({...scope,product:'content'},content).counts.learning,1);
  assert.throws(() => validateBciLineage(scope,content),denied);
});


test('UUID fields reject array-coerced scope, record IDs and parent references', () => {
  // RegExp.test([uuid]) coerces the array to a valid-looking UUID string.
  // Lineage IDs must be primitive strings before map lookup or freezing.
  assert.throws(() => validateBciLineage(scope, [{ ...chain[0], id: [ids[0]] }]), denied);
  const wrappedTenant = [A];
  assert.throws(() => validateBciLineage(
    { tenantId: wrappedTenant, product: 'demand' },
    [{ ...chain[0], tenantId: wrappedTenant }],
  ), denied);
  const wrappedParentId = [ids[0]];
  assert.throws(() => validateBciLineage(scope, [
    { ...chain[0], id: wrappedParentId },
    { ...chain[1], parentIds: [wrappedParentId] },
  ]), denied);
});
