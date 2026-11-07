import test from "node:test";
import assert from "node:assert/strict";
import { assessDemandSellEntitlementCoverage as assess } from "../lib/demand/sell-entitlement-coverage.ts";

// 29 Oct read-only provider-observed aggregate shape, no buyer PII/order UUID.
const order = { orderIdentityDigest: "a".repeat(64),
  observation: "PROVIDER_REPORTED_PAID", orderDisplayNumber: 1007,
  currency: "MYR", bankSettlementVerified: false, entitlementVerified: false };
const inventory = { projectRef: "cyryoirzxpvummckegyh", queryScope: "FULL_TABLE_AGGREGATE",
  products: [{ code: "BROS_SELL_CORE", active: true },
    { code: "BROS_SELL_WEB_OS", active: true }],
  rows: [{ productCode: "BROS_SELL_WEB_OS", status: "active", source: "manual",
    accessLevel: "core", hasExternalPurchaseReference: true,
    directOrderReferenceMatch: false, count: 1 }],
  totalEntitlements: 1, totalEntitlementEvents: 0 };

test("real observed aggregate has no explicit #1007 reference, not proof of no fulfilment", () => {
  const r = assess(order, inventory);
  assert.equal(r.candidateStatus, "NO_EXPLICIT_ORDER_REFERENCE_IN_OBSERVED_ENTITLEMENTS");
  assert.equal(r.activeManualEntitlementsObserved, 1);
  assert.equal(r.activeWebOsEntitlementsObserved, 1);
  assert.equal(r.activeCoreEntitlementsObserved, 0);
  assert.equal(r.entitlementVerifiedForOrder, false);
  assert.equal(r.purchaserAccountMatchVerified, false);
  assert.equal(r.verifiedAcquisitionOutcome, null);
  assert.equal(r.verifiedCpaMinor, null);
  assert.equal(r.durableBciLearningVerified, false);
  assert.ok(Object.isFrozen(r));
  assert.equal(JSON.stringify(r).includes("@"), false);
  assert.equal(r.snapshotKey, assess(structuredClone(order), structuredClone(inventory)).snapshotKey);
});

test("explicit order reference is candidate only, not verified customer entitlement", () => {
  const matched = { ...inventory, rows: [{ ...inventory.rows[0], directOrderReferenceMatch: true }] };
  const r = assess(order, matched);
  assert.equal(r.candidateStatus, "EXPLICIT_ORDER_REFERENCE_CANDIDATE_UNVERIFIED");
  assert.equal(r.explicitReferenceCandidates, 1);
  assert.equal(r.activeExplicitReferenceCandidates, 1);
  assert.equal(r.entitlementVerifiedForOrder, false);
  assert.notEqual(r.snapshotKey, assess(order, inventory).snapshotKey);
});

test("missing, contradictory, forged or incomplete aggregate fails closed", () => {
  const bad = [
    { ...inventory, totalEntitlements: 0 },
    { ...inventory, totalEntitlements: 2 },
    { ...inventory, rows: [...inventory.rows, inventory.rows[0]] },
    { ...inventory, rows: [{ ...inventory.rows[0], count: -1 }] },
    { ...inventory, rows: [{ ...inventory.rows[0], directOrderReferenceMatch: true,
      hasExternalPurchaseReference: false }] },
    { ...inventory, products: [{ code: "BROS_SELL_WEB_OS", active: true }] },
    { ...inventory, projectRef: "other" },
    { ...inventory, verified: true },
    { ...inventory, rows: [{ ...inventory.rows[0], email: "private@example.com" }] },
  ];
  for (const candidate of bad) assert.throws(() => assess(order, candidate));
  assert.throws(() => assess({ ...order, entitlementVerified: true }, inventory));
  assert.throws(() => assess({ ...order, orderIdentityDigest: "bad" }, inventory));
});

test("group ordering stable, revisions change fingerprint, zero events is not zero entitlement", () => {
  const two = { ...inventory, totalEntitlements: 2, rows: [
    inventory.rows[0], { ...inventory.rows[0], productCode: "BROS_SELL_CORE", source: "hitpay" }] };
  assert.equal(assess(order, two).snapshotKey,
    assess(order, { ...two, rows: [...two.rows].reverse(), products: [...two.products].reverse() }).snapshotKey);
  assert.notEqual(assess(order, { ...inventory, totalEntitlementEvents: 1 }).snapshotKey,
    assess(order, inventory).snapshotKey);
  assert.equal(assess(order, inventory).totalEntitlementEventsObserved, 0);
  assert.equal(assess(order, inventory).totalEntitlementsObserved, 1);
});
