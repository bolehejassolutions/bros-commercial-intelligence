/**
 * Portfolio contract regression based on the SHAPE of read-only HitPay
 * observations on 26 Oct 2026 (MYR50 gross, MYR1.70 fees, MYR48.30 payout).
 * IDs are deliberately synthetic; these tests never contact HitPay, attest
 * a live payment, link a payout allocation, or prove entitlement.
 * The Neon/BCI worker owns the shared implementation. This file tests its
 * public pure functions without creating another backend or provider adapter.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reconcileHitPayPaidPair } from "../lib/bci/hitpay-readonly-reconciliation.ts";
import { summarizeGrowthEvidence } from "../lib/bci/growth-evidence-summary.ts";

const orderId = "22222222-2222-4222-8222-222222222222";
const chargeId = "11111111-1111-4111-8111-111111111111";
const tenantId = "33333333-3333-4333-8333-333333333333";
const charge = {
  id: chargeId, remark: `Order #${orderId}`, amount: 5000,
  currency: "myr", status: "succeeded",
  closed_at: "2026-10-08T23:53:25.000000Z",
};
const order = {
  id: orderId, amount: 5000, currency: "myr",
  status: "completed", payment_status: "paid",
  fulfilment_status: "completed",
};
const payout = {
  id: "44444444-4444-4444-8444-444444444444",
  status: "paid", amountMajor: 48.3, currency: "myr",
  // The observed payout listing had NO provider allocation reference.
  chargeAllocationReference: null,
};
const scope = {
  tenantId, product: "demand",
  windowStart: "2026-10-01T00:00:00Z",
  windowEnd: "2026-10-27T00:00:00Z",
};
const evidence = (environment, verification) => ({
  evidenceId: "portfolio-smoke:paid-order",
  tenantId, product: "demand", provider: "hitpay",
  providerRecordId: orderId, kind: "paid_order",
  environment, verification, windowStart: scope.windowStart,
  windowEnd: scope.windowEnd, amountMinor: 5000, currency: "MYR",
});

test("provider-shaped order/charge match is PAID, not independently settled or entitled", () => {
  const pair = reconcileHitPayPaidPair(charge, order);
  assert.equal(pair.grossChargeMinor, 5000);
  assert.equal(pair.providerPaymentState, "paid");
  assert.equal(pair.providerFulfilmentState, "completed");
  assert.equal(pair.payoutSettlement, "unverified");
  assert.equal(pair.digitalEntitlement, "unverified");
  assert.equal(pair.productAttribution, "unverified");
  assert.equal(pair.environment, "unverified");
  assert.equal(pair.acquisitionAttribution, "unverified");
  assert.equal(payout.status, "paid");
  assert.equal(payout.amountMajor, 48.3);
  assert.equal((5000 - 170) / 100, payout.amountMajor);
  assert.equal(payout.chargeAllocationReference, null);
});

test("provider-reported PAID without independent live/test attestation cannot enter verified revenue", () => {
  const summary = summarizeGrowthEvidence(scope, [evidence("unknown", "unverified")]);
  assert.equal(summary.paidOrders, null);
  assert.equal(summary.grossPaidRevenueMinor, null);
  assert.equal(summary.settledOrders, null);
  assert.equal(summary.grossSettledRevenueMinor, null);
  assert.equal(summary.cpaMinor, null);
  assert.equal(summary.excludedTestOrUnverified, 1);
});

test("even synthetic trusted live PAID evidence does not become SETTLED by equal payout amount", () => {
  // Deliberately hypothetical trusted input to exercise the summary contract;
  // NOT a claim that the real HitPay order is independently verified live.
  const summary = summarizeGrowthEvidence(scope, [
    evidence("live", "verified"),
    {
      evidenceId: "portfolio-smoke:meta-attributed",
      tenantId, product: "demand", provider: "meta_ads",
      providerRecordId: "synthetic-meta-attribution", kind: "platform_purchase_event",
      environment: "live", verification: "verified",
      windowStart: scope.windowStart, windowEnd: scope.windowEnd, count: 1,
    },
    {
      evidenceId: "portfolio-smoke:meta-spend",
      tenantId, product: "demand", provider: "meta_ads",
      providerRecordId: "synthetic-meta-spend", kind: "ad_spend",
      environment: "live", verification: "verified",
      windowStart: scope.windowStart, windowEnd: scope.windowEnd,
      amountMinor: 12493, currency: "MYR",
    },
  ]);
  assert.equal(summary.paidOrders, 1);
  assert.equal(summary.grossPaidRevenueMinor, 5000);
  assert.equal(summary.platformAttributedPurchaseEvents, 1);
  assert.equal(summary.verifiedAdSpendMinor, 12493);
  assert.equal(summary.settledOrders, null);
  assert.equal(summary.grossSettledRevenueMinor, null);
  assert.equal(summary.observedOrdersPerQualifiedVisit, null);
  assert.equal(summary.cpaMinor, null);
});


/**
 * PORTFOLIO_READINESS_FALSE_GREEN_GUARD_20261027
 * Cross-product acceptance contract on the existing shared BCI pure functions.
 * All fixtures are SYNTHETIC and do not attest provider identity or hosted E2E.
 */
test("portfolio gate remains OPEN with provider-shaped paid/Meta observations even when external flags are asserted", async () => {
  const { assessInternalReadiness } = await import("../lib/bci/internal-readiness.ts");
  const paid = summarizeGrowthEvidence(scope, [evidence("unknown", "unverified")]);
  assert.equal(paid.settledOrders, null);
  assert.equal(paid.paidOrders, null);
  const readiness = assessInternalReadiness({
    tenantId, contentId: "synthetic-content-1", contentEvidence: [],
    experimentId: "synthetic-experiment-1", demandEvidence: [],
    neonNegativeTestsVerified: true, sharedBciAuditVerified: true,
    hitpayReconciliationVerified: true,
  });
  assert.equal(readiness.internalV1Ready, false);
  assert.deepEqual(readiness.pending, ["contentEvidenceComplete", "demandEvidenceComplete"]);
});

test("portfolio gate does not promote SENT-only or Meta-attributed outcome to completed CONTENT/DEMAND", async () => {
  const { assessInternalReadiness } = await import("../lib/bci/internal-readiness.ts");
  const contentEvidence = [{
    tenantId, product: "content", contentId: "synthetic-content-2",
    stage: "provider_sent", sourceKey: "synthetic:buffer:post",
    verified: true, at: "2026-10-26T02:00:00Z",
    providerPostId: "synthetic-provider-post",
  }];
  const stages = ["diagnosis", "decision", "action", "outcome", "learning"];
  const demandEvidence = stages.map((stage, i) => ({
    tenantId, product: "demand", experimentId: "synthetic-experiment-2",
    stage, sourceKey: `synthetic:stage:${stage}`, verified: true,
    observedAt: new Date(Date.UTC(2026, 9, 26, 3, i)).toISOString(),
    ...(stage === "outcome" ? { outcomeClass: "platform_observation" } : {}),
  }));
  const readiness = assessInternalReadiness({
    tenantId, contentId: "synthetic-content-2", contentEvidence,
    experimentId: "synthetic-experiment-2", demandEvidence,
    neonNegativeTestsVerified: true, sharedBciAuditVerified: true,
    hitpayReconciliationVerified: true,
  });
  assert.equal(readiness.contentEvidenceComplete, false);
  assert.equal(readiness.demandEvidenceComplete, false);
  assert.equal(readiness.internalV1Ready, false);
  assert.deepEqual(readiness.pending, ["contentEvidenceComplete", "demandEvidenceComplete"]);
});


/**
 * PORTFOLIO_SCOPE_TEST_SETTLEMENT_CONFLICT_GUARD_20261027
 * Synthetic cross-product/tenant and live-vs-test conflict acceptance tests.
 * This tests the shared BCI projection; it does NOT prove authenticated RLS.
 */
test("portfolio HitPay evidence cannot cross tenant or CONTENT/DEMAND product scopes", () => {
  const verified = evidence("live", "verified");
  assert.throws(() => summarizeGrowthEvidence(scope, [
    { ...verified, tenantId: "55555555-5555-4555-8555-555555555555" },
  ]), /Invalid or inconsistent BCI growth evidence/);
  assert.throws(() => summarizeGrowthEvidence(scope, [
    { ...verified, product: "content" },
  ]), /Invalid or inconsistent BCI growth evidence/);
  const clean = summarizeGrowthEvidence(scope, [verified]);
  assert.equal(clean.paidOrders, 1);
  assert.equal(clean.settledOrders, null);
  assert.equal(clean.cpaMinor, null);
});

test("a test PAID order cannot be promoted by a live SETTLED row for the same provider order", () => {
  const untrustedPaid = evidence("test", "unverified");
  const claimedSettlement = {
    ...evidence("live", "verified"),
    evidenceId: "portfolio-smoke:claimed-settlement",
    kind: "settled_order",
    settlementReference: "synthetic-payout-ref-not-provider-attested",
  };
  assert.throws(() => summarizeGrowthEvidence(scope, [
    untrustedPaid, claimedSettlement,
  ]), /Invalid or inconsistent BCI growth evidence/);
});
