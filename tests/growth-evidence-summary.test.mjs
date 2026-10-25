import test from "node:test";
import assert from "node:assert/strict";
import { summarizeGrowthEvidence } from "../lib/bci/growth-evidence-summary.ts";

const tenantId = "11111111-1111-4111-8111-111111111111";
const otherTenant = "22222222-2222-4222-8222-222222222222";
const scope = { tenantId, product: "demand", windowStart: "2026-10-01T00:00:00Z", windowEnd: "2026-10-08T00:00:00Z" };
let i = 0;
function record(kind, provider, extras = {}) {
  return { evidenceId: `e-${++i}`, providerRecordId: `p-${i}`, ...scope, kind, provider,
    environment: "live", verification: "verified", ...extras };
}
const error = /invalid or inconsistent BCI growth evidence/i;

test("verified live settled HitPay orders only; no conversion from Meta Purchase events", () => {
  const rows = [
    record("settled_order", "hitpay", { amountMinor: 10000, currency: "MYR" }),
    record("platform_purchase_event", "meta_ads", { count: 4 }),
    record("qualified_visit_count", "ga4", { count: 50 }),
    record("ad_spend", "meta_ads", { amountMinor: 3000, currency: "MYR" }),
  ];
  const result = summarizeGrowthEvidence(scope, rows);
  assert.equal(result.settledOrders, 1);
  assert.equal(result.grossSettledRevenueMinor, 10000);
  assert.equal(result.platformAttributedPurchaseEvents, 4);
  assert.equal(result.observedOrdersPerQualifiedVisit, 1 / 50);
  assert.equal(result.verifiedAdSpendMinor, 3000);
  assert.equal(result.cpaMinor, null);
});

test("sandbox and unverified events never become verified sales or revenue", () => {
  const result = summarizeGrowthEvidence(scope, [
    record("settled_order", "hitpay", { environment: "test", amountMinor: 10000, currency: "MYR" }),
    record("settled_order", "hitpay", { verification: "unverified", amountMinor: 10000, currency: "MYR" }),
    record("platform_purchase_event", "meta_ads", { count: 3 }),
  ]);
  assert.equal(result.settledOrders, null);
  assert.equal(result.grossSettledRevenueMinor, null);
  assert.equal(result.platformAttributedPurchaseEvents, 3);
  assert.equal(result.excludedTestOrUnverified, 2);
  assert.equal(result.observedOrdersPerQualifiedVisit, null);
});

test("idempotent duplicate provider record and conflicting replays rejected", () => {
  const row = record("settled_order", "hitpay", { amountMinor: 10000, currency: "MYR" });
  const result = summarizeGrowthEvidence(scope, [row, { ...row, evidenceId: "new-ingest-id" }]);
  assert.equal(result.settledOrders, 1);
  assert.equal(result.grossSettledRevenueMinor, 10000);
  assert.equal(result.distinctEvidenceRecords, 1);
  assert.throws(() => summarizeGrowthEvidence(scope, [row, { ...row, amountMinor: 9000 }]), error);
  assert.throws(() => summarizeGrowthEvidence(scope, [row, { ...row, environment: "test" }]), error);
});

test("zero is not unknown; absent numerator or denominator prevents a rate", () => {
  const zero = summarizeGrowthEvidence(scope, [record("qualified_visit_count", "ga4", { count: 0 })]);
  assert.equal(zero.qualifiedVisits, 0);
  assert.equal(zero.settledOrders, null);
  assert.equal(zero.observedOrdersPerQualifiedVisit, null);
  const empty = summarizeGrowthEvidence(scope, []);
  assert.equal(empty.qualifiedVisits, null);
  assert.equal(empty.grossSettledRevenueMinor, null);
  assert.equal(empty.verifiedAdSpendMinor, null);
});

test("cross-tenant/product and window mismatch fail rather than filter", () => {
  const row = record("settled_order", "hitpay", { amountMinor: 10000, currency: "MYR" });
  for (const variant of [
    { tenantId: otherTenant }, { product: "content" },
    { windowEnd: "2026-10-09T00:00:00Z" },
  ]) assert.throws(() => summarizeGrowthEvidence(scope, [{ ...row, ...variant }]), error);
});

test("malformed provider/type/amount and unsafe totals fail closed", () => {
  const row = record("settled_order", "hitpay", { amountMinor: 10000, currency: "MYR" });
  for (const variant of [
    { provider: "meta_ads" }, { amountMinor: -1 }, { amountMinor: 1.2 },
    { amountMinor: Infinity }, { currency: "USD" }, { count: 1 },
    { verification: "self_attested" }, { environment: "sandbox_unknown" },
  ]) assert.throws(() => summarizeGrowthEvidence(scope, [{ ...row, ...variant }]), error);
  const spend1 = record("ad_spend", "meta_ads", { amountMinor: Number.MAX_SAFE_INTEGER, currency: "MYR" });
  const spend2 = record("ad_spend", "meta_ads", { amountMinor: 1, currency: "MYR" });
  assert.throws(() => summarizeGrowthEvidence(scope, [spend1, spend2]), error);
});

test("content and demand share same summarizer but cannot mix product records", () => {
  const contentScope = { ...scope, product: "content" };
  const row = record("qualified_lead_count", "manual", { product: "content", count: 2 });
  assert.equal(summarizeGrowthEvidence(contentScope, [row]).qualifiedLeads, 2);
  assert.throws(() => summarizeGrowthEvidence(scope, [row]), error);
});
