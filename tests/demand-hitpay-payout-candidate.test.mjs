import test from "node:test";
import assert from "node:assert/strict";
import { assessDemandHitPayPayoutCandidate as assess } from "../lib/demand/hitpay-payout-candidate.ts";

// Provider-shaped payout observed 29 Oct 2026; ID is synthetic, no PII.
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const payout = { id, status: "paid", currency: "myr", payment_provider: "stripe_my",
  amount: 48.3, created_at: "2026-10-11T16:03:10.000000Z",
  remark: "HitPay Payouts for 2026-10-12", reference: null };
const page = { data: [payout], has_more: false, next_cursor: null };
const paidOrder = { snapshotKey: "demand:hitpay-provider-readback:sha256:" + "a".repeat(64),
  observation: "PROVIDER_REPORTED_PAID", netAfterFeesMinor: 4830,
  payoutAllocationVerified: false, bankSettlementVerified: false };
const query = { dateFrom: "2026-10-01", dateTo: "2026-10-29" };
const run = (p = page, o = paidOrder, q = query) => assess(p, o, q);

test("real provider-shaped paid payout matches net amount but cannot attest charge allocation", () => {
  const r = run();
  assert.equal(r.providerReportedPaidPayoutRows, 1);
  assert.equal(r.sameNetAmountPaidPayoutRows, 1);
  assert.equal(r.candidateStatus, "ONE_NET_AMOUNT_MATCH_UNLINKED");
  assert.equal(r.payoutAllocationVerified, false);
  assert.equal(r.bankReceiptVerified, false);
  assert.equal(r.providerAuthenticatedForDemandApp, false);
  assert.equal(r.verifiedSettledOrders, null);
  assert.equal(r.verifiedCpaMinor, null);
  assert.equal(r.verifiedAcquisitionOutcome, null);
  assert.equal(r.durableBciLearningVerified, false);
  assert.equal(JSON.stringify(r).includes(id), false);
  assert.equal(JSON.stringify(r).includes("HitPay Payouts"), false);
  assert.equal(run(structuredClone(page)).snapshotKey, r.snapshotKey);
  assert.ok(Object.isFrozen(r));
});

test("absent or multiple paid matches never establish allocation", () => {
  const no = run({ ...page, data: [{ ...payout, amount: 40 }] });
  assert.equal(no.candidateStatus, "NO_NET_AMOUNT_MATCH_IN_BOUNDED_INVENTORY");
  const second = { ...payout, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  const multiple = run({ ...page, data: [second, payout] });
  assert.equal(multiple.candidateStatus, "MULTIPLE_NET_AMOUNT_MATCHES_UNLINKED");
  assert.equal(multiple.payoutAllocationVerified, false);
  assert.equal(multiple.snapshotKey, run({ ...page, data: [payout, second] }).snapshotKey);
});

test("incomplete pagination, duplicate IDs, malformed money/status/time and forged paid order fail closed", () => {
  for (const p of [
    { ...page, has_more: true }, { ...page, next_cursor: "next" },
    { ...page, data: [payout, payout] },
    { ...page, data: [{ ...payout, amount: 48.301 }] },
    { ...page, data: [{ ...payout, amount: "48.30" }] },
    { ...page, data: [{ ...payout, status: "mystery" }] },
    { ...page, data: [{ ...payout, id: [id] }] },
    { ...page, data: [{ ...payout, created_at: "2026-02-30T00:00:00Z" }] },
  ]) assert.throws(() => run(p));
  for (const o of [
    { ...paidOrder, bankSettlementVerified: true },
    { ...paidOrder, payoutAllocationVerified: true },
    { ...paidOrder, observation: "REFUND_OBSERVED" },
    { ...paidOrder, snapshotKey: "fake" },
  ]) assert.throws(() => run(page, o));
  assert.throws(() => run(page, paidOrder, { dateFrom: "2026-10-30", dateTo: "2026-10-01" }));
});

test("status revisions, monetary revisions and query windows change snapshot", () => {
  const base = run();
  const processing = run({ ...page, data: [{ ...payout, status: "processing" }] });
  assert.equal(processing.providerReportedPaidPayoutRows, 0);
  assert.notEqual(processing.snapshotKey, base.snapshotKey);
  assert.notEqual(run({ ...page, data: [{ ...payout, amount: 48.31 }] }).snapshotKey, base.snapshotKey);
  assert.notEqual(run(page, paidOrder, { dateFrom: "2026-10-02", dateTo: "2026-10-29" }).snapshotKey, base.snapshotKey);
});

test("live 11/12 October payout filter boundary uses MYT created-day advisory, not UTC date or settlement", () => {
  // Actual read-only HitPay queries on 29 Oct: 11 Oct returned no rows;
  // 12 Oct returned the paid payout created 11 Oct 16:03 UTC = 12 Oct MYT.
  // This is provider-observed shape, not app-owned authenticated ingestion.
  const on12 = run(page, paidOrder, { dateFrom: "2026-10-12", dateTo: "2026-10-12" });
  assert.equal(on12.observedPayoutsOutsideMytCreatedWindow, 0);
  assert.equal(on12.sameNetAmountPaidPayoutRows, 1);
  assert.equal(on12.payoutDateFilterSemanticsVerified, false);
  assert.equal(on12.bankReceiptVerified, false);
  const noRows11 = run({ data: [], has_more: false, next_cursor: null },
    paidOrder, { dateFrom: "2026-10-11", dateTo: "2026-10-11" });
  assert.equal(noRows11.observedPayoutRows, 0);
  assert.equal(noRows11.verifiedSettledOrders, null);
  // An inconsistent caller envelope is REVIEW, not a rejected or verified payout.
  const mismatched = run(page, paidOrder, { dateFrom: "2026-10-13", dateTo: "2026-10-13" });
  assert.equal(mismatched.observedPayoutsOutsideMytCreatedWindow, 1);
  assert.equal(mismatched.nextEvidenceAction, "VERIFY_HITPAY_PAYOUT_DATE_FILTER_BASIS");
  assert.equal(mismatched.payoutAllocationVerified, false);
  assert.notEqual(mismatched.snapshotKey, on12.snapshotKey);
});
