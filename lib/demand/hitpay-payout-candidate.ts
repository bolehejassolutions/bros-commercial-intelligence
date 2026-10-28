import { createHash } from "node:crypto";

/**
 * DEMAND-only candidate comparison of independent HitPay payout inventory
 * against a separately reconciled paid-order readback. Provider connector
 * authentication is NOT application-owned, and payout inventory has no
 * per-charge allocation or bank receipt. Never infer settlement or CAC.
 */
type Payout = Readonly<{
  id: unknown;
  status: unknown;
  currency: unknown;
  payment_provider: unknown;
  amount: unknown;
  created_at: unknown;
}>;
type Page = Readonly<{
  data: Payout[];
  has_more: boolean;
  next_cursor: string | null;
}>;
type PaidOrderReadback = Readonly<{
  snapshotKey: string;
  observation: string;
  netAfterFeesMinor: number;
  payoutAllocationVerified: false;
  bankSettlementVerified: false;
}>;
type Query = Readonly<{ dateFrom: string; dateTo: string }>;

const invalid = (): never => { throw new Error("Invalid BROS DEMAND payout candidate evidence"); };
const validDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v + "T00:00:00Z")) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const toMinor = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 ||
      !Number.isSafeInteger(Math.round(v * 100)) ||
      Math.round(v * 100) / 100 !== v) invalid();
  return Math.round((v as number) * 100);
};
const validTimestamp = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v)) return false;
  const parsed = new Date(v);
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 19) === v.slice(0, 19);
};

export function assessDemandHitPayPayoutCandidate(
  page: Page,
  paidOrder: PaidOrderReadback,
  query: Query,
) {
  if (!query || !validDate(query.dateFrom) || !validDate(query.dateTo) ||
      query.dateFrom > query.dateTo || !page || !Array.isArray(page.data) ||
      page.has_more !== false || page.next_cursor !== null ||
      page.data.length > 25 || !paidOrder ||
      typeof paidOrder.snapshotKey !== "string" ||
      !/^demand:hitpay-provider-readback:sha256:[a-f0-9]{64}$/.test(paidOrder.snapshotKey) ||
      paidOrder.observation !== "PROVIDER_REPORTED_PAID" ||
      !Number.isSafeInteger(paidOrder.netAfterFeesMinor) ||
      paidOrder.netAfterFeesMinor < 0 ||
      paidOrder.payoutAllocationVerified !== false ||
      paidOrder.bankSettlementVerified !== false) invalid();

  const seen = new Set<string>();
  const observations = page.data.map(row => {
    if (!row || typeof row.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.id) ||
        seen.has(row.id.toLowerCase()) ||
        typeof row.currency !== "string" || row.currency.toLowerCase() !== "myr" ||
        typeof row.payment_provider !== "string" ||
        !/^[a-z][a-z0-9_]{1,40}$/.test(row.payment_provider) ||
        !["paid", "succeeded", "processing", "to_be_processed", "requires_admin_action", "reverted"].includes(String(row.status)) ||
        typeof row.status !== "string" || !validTimestamp(row.created_at)) invalid();
    const id = row.id as string;
    seen.add(id.toLowerCase());
    return {
      id: id.toLowerCase(),
      status: row.status as string,
      provider: row.payment_provider,
      amountMinor: toMinor(row.amount),
      createdAt: row.created_at,
      // HitPay's 12 Oct payout was created at 11 Oct 16:03 UTC,
      // i.e. 12 Oct MYT. The API's filter basis is NOT attested here.
      createdMytDate: new Date(Date.parse(row.created_at) + 8 * 60 * 60 * 1000)
        .toISOString().slice(0, 10),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const paid = observations.filter(x => x.status === "paid" || x.status === "succeeded");
  const netAmountMatches = paid.filter(x => x.amountMinor === paidOrder.netAfterFeesMinor);
  // Diagnostic only: provider date filters may use a payout-effective date
  // rather than UTC creation time. Never reject legitimate rows or infer
  // a universal filter rule from a single live observed boundary.
  const outsideMytCreatedWindow = observations.filter(x =>
    x.createdMytDate < query.dateFrom || x.createdMytDate > query.dateTo).length;
  const snapshotKey = "demand:hitpay-payout-candidate:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1", query.dateFrom, query.dateTo,
      paidOrder.snapshotKey, observations.map(x => [x.id, x.status, x.provider, x.amountMinor, x.createdAt])]))
    .digest("hex");
  return Object.freeze({
    snapshotKey,
    queryWindow: Object.freeze({ dateFrom: query.dateFrom, dateTo: query.dateTo }),
    observedPayoutRows: observations.length,
    providerReportedPaidPayoutRows: paid.length,
    sameNetAmountPaidPayoutRows: netAmountMatches.length,
    observedPayoutsOutsideMytCreatedWindow: outsideMytCreatedWindow,
    payoutDateFilterSemanticsVerified: false as const,
    candidateStatus: netAmountMatches.length === 0
      ? "NO_NET_AMOUNT_MATCH_IN_BOUNDED_INVENTORY" as const
      : netAmountMatches.length === 1
        ? "ONE_NET_AMOUNT_MATCH_UNLINKED" as const
        : "MULTIPLE_NET_AMOUNT_MATCHES_UNLINKED" as const,
    // A paid payout of the same amount can include unrelated transactions.
    // Payout list has no charge allocation, bank statement or entitlement.
    providerAuthenticatedForDemandApp: false as const,
    payoutAllocationVerified: false as const,
    bankReceiptVerified: false as const,
    verifiedSettledOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    causalLift: null,
    verifiedAcquisitionOutcome: null,
    durableBciLearningVerified: false as const,
    nextEvidenceAction: outsideMytCreatedWindow > 0
      ? "VERIFY_HITPAY_PAYOUT_DATE_FILTER_BASIS" as const
      : "OBTAIN_CHARGE_TO_PAYOUT_ALLOCATION_AND_BANK_RECEIPT" as const,
  });
}
