import test from "node:test";
import assert from "node:assert/strict";
import { planUntrustedBciAuditAppend } from "../lib/bci/audit-append-plan.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const foreignTenant = "22222222-2222-4222-8222-222222222222";
const scope = { tenantId: tenant, product: "demand" };
const stages = ["evidence", "signal", "case", "diagnosis", "decision", "action", "outcome", "learning"];
const ids = stages.map((_, i) =>
  `${String(i + 1).padStart(8, "0")}-3333-4333-8333-333333333333`);
const chain = stages.map((stage, i) => ({
  id: ids[i], tenantId: tenant, product: "demand", stage,
  sourceSystem: i === 0 ? "meta_ads" : "bci_internal",
  sourceRecordKey: `offline-v1-${stage}`,
  recordedAt: `2026-10-25T${String(i).padStart(2, "0")}:00:00Z`,
  parentIds: i ? [ids[i - 1]] : [], verification: "unverified",
}));
const denied = /Invalid BCI (audit append|evidence lineage)/;

test("plans unordered append in dependency order, without claiming durable/provider success", () => {
  const plan = planUntrustedBciAuditAppend(scope, chain.slice(0, 2), chain.slice(2).reverse());
  assert.deepEqual(plan.toInsert.map(r => r.stage), stages.slice(2));
  assert.equal(plan.structurallyLinkedLearnings, 1);
  assert.deepEqual(plan.replayedIds, []);
  assert.equal(plan.authenticated, false);
  assert.equal(plan.providerAttested, false);
  assert.equal(plan.persisted, false);
  assert.ok(Object.isFrozen(plan.toInsert));
  assert.ok(Object.isFrozen(plan.toInsert[0]));
});

test("exact persisted replay is idempotent; repeated new records are inserted once", () => {
  const replay = planUntrustedBciAuditAppend(scope, chain.slice(0, 2),
    [chain[0], { ...chain[0] }, chain[2], { ...chain[2] }]);
  assert.deepEqual(replay.replayedIds, [ids[0]]);
  assert.deepEqual(replay.toInsert.map(r => r.id), [ids[2]]);
});

test("conflicting historical ID and same source key under a new ID fail closed", () => {
  assert.throws(() => planUntrustedBciAuditAppend(scope, [chain[0]],
    [{ ...chain[0], sourceRecordKey: "changed" }]), denied);
  assert.throws(() => planUntrustedBciAuditAppend(scope, [chain[0]],
    [{ ...chain[0], id: ids[1] }]), denied);
  assert.throws(() => planUntrustedBciAuditAppend(scope, [chain[0], { ...chain[0] }], []), denied);
});

test("untrusted provider verification claims and extra fields cannot enter the audit plan", () => {
  assert.throws(() => planUntrustedBciAuditAppend(scope, [], [
    { ...chain[0], verification: "provider_reported" }]), denied);
  assert.throws(() => planUntrustedBciAuditAppend(scope, [], [
    { ...chain[0], verification: "verified" }]), denied);
  assert.throws(() => planUntrustedBciAuditAppend(scope, [], [
    { ...chain[0], secret: "must-not-persist" }]), denied);
});

test("cross-tenant/product and missing/invalid ancestry fail closed", () => {
  assert.throws(() => planUntrustedBciAuditAppend(scope, [], [
    { ...chain[0], tenantId: foreignTenant }]), denied);
  assert.throws(() => planUntrustedBciAuditAppend(scope, [], [
    { ...chain[0], product: "content" }]), denied);
  assert.throws(() => planUntrustedBciAuditAppend(scope, [], [chain[2]]), denied);
  assert.throws(() => planUntrustedBciAuditAppend(scope, [chain[0]], [
    { ...chain[1], parentIds: [foreignTenant] }]), denied);
});

test("stored provider-attested metadata stays historical but does not attest new events", () => {
  const stored = { ...chain[0], verification: "verified" };
  const plan = planUntrustedBciAuditAppend(scope, [stored], [chain[1]]);
  assert.deepEqual(plan.toInsert.map(r => r.id), [ids[1]]);
  assert.equal(plan.providerAttested, false);
  assert.equal(plan.persisted, false);
});


test('untrusted audit append rejects array-coerced UUID identifiers before planning', () => {
  assert.throws(() => planUntrustedBciAuditAppend(scope, [], [
    { ...chain[0], id: [ids[0]] },
  ]), denied);
  const wrappedTenant = [tenant];
  assert.throws(() => planUntrustedBciAuditAppend(
    { tenantId: wrappedTenant, product: 'demand' }, [],
    [{ ...chain[0], tenantId: wrappedTenant }],
  ), denied);
});
