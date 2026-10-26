import test from "node:test";
import assert from "node:assert/strict";
import { reconcileHitPayPaidPair } from "../lib/bci/hitpay-readonly-reconciliation.ts";

const chargeId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const charge = { id: chargeId, remark: `Order #${orderId}`, status: "succeeded",
  amount: 5000, currency: "myr", closed_at: "2026-10-09T07:53:25+08:00" };
const order = { id: orderId, amount: 5000, currency: "myr", status: "completed",
  payment_status: "paid", fulfilment_status: "completed" };
const mismatch = /HitPay read-only reconciliation mismatch/;

test("two provider list records match, but neither product nor settlement is invented", () => {
  const row = reconcileHitPayPaidPair(charge, order);
  assert.equal(row.grossChargeMinor, 5000);
  assert.equal(row.providerPaymentState, "paid");
  assert.equal(row.providerFulfilmentState, "completed");
  for (const key of ["environment", "productAttribution", "refundState", "payoutSettlement",
    "digitalEntitlement", "acquisitionAttribution"]) assert.equal(row[key], "unverified");
  assert.equal(Object.isFrozen(row), true);
  assert.equal(row.sourceKey, `hitpay:charge:${chargeId}`);
});

test("idempotent provider source key independent of repeated reads", () => {
  assert.deepEqual(reconcileHitPayPaidPair(charge, order), reconcileHitPayPaidPair({ ...charge }, { ...order }));
});

test("mismatched order reference, amount, currency or charge id fail closed", () => {
  for (const c of [
    { ...charge, remark: `Order #${chargeId}` },
    { ...charge, remark: `Order #${orderId} extra` },
    { ...charge, amount: 5001 }, { ...charge, currency: "usd" },
    { ...charge, id: "not-uuid" }, { ...charge, currency: null },
  ]) assert.throws(() => reconcileHitPayPaidPair(c, order), mismatch);
  assert.throws(() => reconcileHitPayPaidPair(charge, { ...order, id: chargeId }), mismatch);
});

test("failed, refunded, unpaid or canceled provider rows cannot become paid pairs", () => {
  for (const status of ["failed", "refunded", "pending"]) {
    assert.throws(() => reconcileHitPayPaidPair({ ...charge, status }, order), mismatch);
  }
  for (const o of [
    { ...order, payment_status: "awaiting_payment" },
    { ...order, status: "canceled" },
    { ...order, fulfilment_status: "canceled" },
  ]) assert.throws(() => reconcileHitPayPaidPair(charge, o), mismatch);
});

test("invalid amounts and timestamps fail rather than coerce major/minor units", () => {
  for (const amount of [0, -1, 50.00, 5000.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "5000"]) {
    assert.throws(() => reconcileHitPayPaidPair({ ...charge, amount }, order), mismatch);
  }
  for (const closed_at of ["yesterday", "2026-10-09", "", "2026-10-09T07:53:25"]) {
    assert.throws(() => reconcileHitPayPaidPair({ ...charge, closed_at }, order), mismatch);
  }
});

test("reject impossible calendar instants, rollover times and timezone offsets", () => {
  for (const closed_at of [
    "2026-02-29T07:53:25+08:00", "2026-04-31T07:53:25+08:00",
    "2026-13-09T07:53:25+08:00", "2026-10-09T24:00:00+08:00",
    "2026-10-09T07:60:00+08:00", "2026-10-09T07:53:60+08:00",
    "2026-10-09T07:53:25+15:00", "2026-10-09T07:53:25+14:30",
    "2026-10-09T07:53:25+08:60",
  ]) assert.throws(() => reconcileHitPayPaidPair({ ...charge, closed_at }, order), mismatch);
  for (const closed_at of [
    "2024-02-29T23:59:59Z", "2026-10-09T07:53:25.123+08:00",
    "2026-10-09T07:53:25-05:30",
  ]) assert.equal(reconcileHitPayPaidPair({ ...charge, closed_at }, order).closedAt, closed_at);
});

test("pending provider fulfilment remains pending; no entitlement inferred", () => {
  const row = reconcileHitPayPaidPair(charge, { ...order, fulfilment_status: "pending" });
  assert.equal(row.providerFulfilmentState, "pending");
  assert.equal(row.digitalEntitlement, "unverified");
});
