import test from "node:test";
import assert from "node:assert/strict";
import { assessDemandHitPayProductCohort as assess } from "../lib/demand/hitpay-product-cohort.ts";

// Synthetic merchant IDs; financial shape reflects a bounded historical read.
const productId = "a0000000-0000-4000-8000-000000000001";
const orderId = "a0000000-0000-4000-8000-000000000002";
const baseline = {
  dayMyt: "2026-10-09", expectedProductId: productId,
  expectedHistoricalProductName: "BROS SELL™ — Closing OS",
  productsQueryChannel: "store_checkout", summaryQueryChannel: "api_store",
  orders: { data: [{ id: orderId, order_display_number: 1007,
    channel: "store_checkout", amount: 5000, currency: "myr",
    status: "completed", payment_status: "paid",
    created_at: "2026-10-08T23:53:01.000000Z" }],
    has_more: false, next_cursor: null },
  topProducts: [{ product_id: productId, product_name: "BROS SELL™ — Closing OS",
    sold: 1, gross_sales: 5000, currency: "myr" }],
  salesSummary: { currency: "myr", payments: 1, gross_sales: 5000,
    refunds: 0, total_fees: 170, net_collected: 4830 },
};

test("single-day product cohort aligns without proving order line item", () => {
  const r = assess(baseline);
  assert.equal(r.status, "COHORT_TOTALS_ALIGN_UNATTESTED");
  assert.equal(r.observedProductUnits, 1);
  assert.equal(r.orderGrossMinor, 5000);
  assert.equal(r.observedSummaryNetCollectedMinor, 4830);
  for (const field of ["topProductListCompleteVerified", "channelScopeEquivalenceVerified",
    "directOrderLineItemJoinVerified", "metaEventToOrderJoinVerified",
    "bankSettlementVerified", "entitlementVerified", "durableBciLearningVerified"])
    assert.equal(r[field], false);
  for (const field of ["verifiedAcquisitionOutcome", "verifiedCpaMinor",
    "verifiedCacMinor", "verifiedConversionRate", "causalLift"])
    assert.equal(r[field], null);
  assert.equal(r.snapshotKey, assess(structuredClone(baseline)).snapshotKey);
  assert.equal(JSON.stringify(r).includes(orderId), false);
  assert.equal(JSON.stringify(r).includes(productId), false);
  assert.ok(Object.isFrozen(r));
});

test("missing target in top-N is unread, never zero sales", () => {
  const r = assess({ ...baseline, topProducts: [] });
  assert.equal(r.status, "PRODUCT_NOT_IN_TOP_RESULTS_UNREAD");
  assert.equal(r.observedProductUnits, null);
  assert.equal(r.directOrderLineItemJoinVerified, false);
});

test("inconsistent aggregates and product name mismatch remain unverified", () => {
  for (const variant of [
    { ...baseline, salesSummary: { ...baseline.salesSummary, payments: 2 } },
    { ...baseline, salesSummary: { ...baseline.salesSummary, net_collected: 4900 } },
    { ...baseline, topProducts: [{ ...baseline.topProducts[0], sold: 2 }] },
    { ...baseline, topProducts: [{ ...baseline.topProducts[0], product_name: "Other" }] },
  ]) {
    const r = assess(variant);
    assert.equal(r.status, "COHORT_TOTALS_REQUIRE_REVIEW");
    assert.equal(r.verifiedAcquisitionOutcome, null);
    assert.notEqual(r.snapshotKey, assess(baseline).snapshotKey);
  }
});

test("reject partial pages, duplicate products, invalid money, dates and channels", () => {
  const bad = [
    { ...baseline, orders: { ...baseline.orders, has_more: true } },
    { ...baseline, orders: { ...baseline.orders, data: [] } },
    { ...baseline, orders: { ...baseline.orders, data: [{ ...baseline.orders.data[0], created_at: "2026-10-09T23:53:01Z" }] } },
    { ...baseline, orders: { ...baseline.orders, data: [{ ...baseline.orders.data[0], payment_status: "awaiting_payment" }] } },
    { ...baseline, orders: { ...baseline.orders, data: [{ ...baseline.orders.data[0], currency: null }] } },
    { ...baseline, topProducts: [...baseline.topProducts, baseline.topProducts[0]] },
    { ...baseline, salesSummary: { ...baseline.salesSummary, total_fees: -1 } },
    { ...baseline, productsQueryChannel: "point_of_sale" },
    { ...baseline, dayMyt: "2026-02-30" },
  ];
  for (const x of bad) assert.throws(() => assess(x));
});

test("fingerprint stable across ordering and changes for material revisions", () => {
  const extra = { product_id: "a0000000-0000-4000-8000-000000000003",
    product_name: "Unrelated", sold: 1, gross_sales: 1000, currency: "myr" };
  const two = { ...baseline, topProducts: [...baseline.topProducts, extra] };
  assert.equal(assess(two).snapshotKey,
    assess({ ...two, topProducts: [...two.topProducts].reverse() }).snapshotKey);
  assert.notEqual(assess(two).snapshotKey, assess(baseline).snapshotKey);
  assert.notEqual(assess({ ...baseline, salesSummary: { ...baseline.salesSummary, refunds: 100 } }).snapshotKey,
    assess(baseline).snapshotKey);
});
