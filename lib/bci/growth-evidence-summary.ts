/**
 * Deterministic INTERNAL BCI evidence summary for CONTENT/DEMAND.
 * Not an ingestion adapter, authorization boundary, or attribution engine.
 * Only trusted server-side adapters may mark evidence `verified`; a provider
 * event or test checkout must never be promoted to a settled HitPay sale.
 * A succeeded HitPay charge is PAID, not SETTLED, until payout is evidenced.
 */
export type GrowthProduct = "content" | "demand";
export type GrowthKind =
  | "paid_order"
  | "settled_order"
  | "platform_purchase_event"
  | "qualified_visit_count"
  | "qualified_lead_count"
  | "ad_spend";
export type GrowthProvider = "hitpay" | "meta_ads" | "ga4" | "manual";
export type GrowthEvidence = Readonly<{
  evidenceId: string;
  tenantId: string;
  product: GrowthProduct;
  provider: GrowthProvider;
  providerRecordId: string;
  kind: GrowthKind;
  environment: "live" | "test" | "unknown";
  verification: "verified" | "unverified";
  windowStart: string;
  windowEnd: string;
  count?: number;
  amountMinor?: number;
  currency?: "MYR";
  /** Required for settled_order only: verified provider payout/settlement reference. */
  settlementReference?: string;
}>;
export type GrowthScope = Readonly<{
  tenantId: string;
  product: GrowthProduct;
  windowStart: string;
  windowEnd: string;
}>;
export type GrowthSummary = Readonly<{
  scope: GrowthScope;
  qualifiedVisits: number | null;
  qualifiedLeads: number | null;
  platformAttributedPurchaseEvents: number | null;
  paidOrders: number | null;
  grossPaidRevenueMinor: number | null;
  settledOrders: number | null;
  grossSettledRevenueMinor: number | null;
  verifiedAdSpendMinor: number | null;
  observedOrdersPerQualifiedVisit: number | null;
  cpaMinor: null;
  excludedTestOrUnverified: number;
  distinctEvidenceRecords: number;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const allowedProviders: Readonly<Record<GrowthKind, readonly GrowthProvider[]>> = {
  paid_order: ["hitpay"],
  settled_order: ["hitpay"],
  platform_purchase_event: ["meta_ads"],
  qualified_visit_count: ["ga4", "manual"],
  qualified_lead_count: ["ga4", "manual"],
  ad_spend: ["meta_ads"],
};
const fail = (): never => { throw new Error("Invalid or inconsistent BCI growth evidence"); };
const isTime = (v: unknown): v is string =>
  typeof v === "string" && ISO_UTC.test(v) && Number.isFinite(Date.parse(v));
const isAmount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const safeAdd = (a: number, b: number): number => {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) fail();
  return sum;
};

/**
 * Fail closed on mixed scopes, malformed records and conflicting source IDs.
 * Null means unobserved; a provider-confirmed zero-count record means zero.
 * For settled_order a trusted adapter must provide a verified payout reference;
 * the field is a required provenance contract, not independent proof of payout.
 * CPA deliberately remains null: same-window spend and orders alone do not
 * establish a reconciled acquisition denominator or campaign attribution.
 */
export function summarizeGrowthEvidence(
  scope: GrowthScope,
  evidence: readonly GrowthEvidence[],
): GrowthSummary {
  if (!scope || !UUID.test(scope.tenantId) ||
      (scope.product !== "content" && scope.product !== "demand") ||
      !isTime(scope.windowStart) || !isTime(scope.windowEnd) ||
      Date.parse(scope.windowStart) >= Date.parse(scope.windowEnd) ||
      !Array.isArray(evidence) || evidence.length > 10000) fail();

  const unique = new Map<string, string>();
  // One ingestion evidence ID must never refer to two different provider facts.
  const evidenceIdToSource = new Map<string, string>();
  const paidByProviderOrder = new Map<string, number>();
  const settledByProviderOrder = new Map<string, number>();
  const totals: Partial<Record<GrowthKind, number>> = {};
  let excluded = 0;
  for (const item of evidence) {
    if (!item || typeof item !== "object" ||
        item.tenantId !== scope.tenantId || item.product !== scope.product ||
        item.windowStart !== scope.windowStart || item.windowEnd !== scope.windowEnd ||
        typeof item.evidenceId !== "string" || !item.evidenceId.trim() ||
        typeof item.providerRecordId !== "string" || !item.providerRecordId.trim() ||
        !Object.prototype.hasOwnProperty.call(allowedProviders, item.kind) ||
        !allowedProviders[item.kind]?.includes(item.provider) ||
        !["live", "test", "unknown"].includes(item.environment) ||
        !["verified", "unverified"].includes(item.verification)) fail();
    const money = item.kind === "paid_order" || item.kind === "settled_order" || item.kind === "ad_spend";
    if (money) {
      if (!isAmount(item.amountMinor) || item.currency !== "MYR" || item.count !== undefined ||
          ((item.kind === "paid_order" || item.kind === "settled_order") && item.amountMinor === 0)) fail();
    } else if (!isAmount(item.count) || item.amountMinor !== undefined || item.currency !== undefined) fail();
    if (item.kind === "settled_order") {
      if (typeof item.settlementReference !== "string" ||
          item.settlementReference.length < 1 || item.settlementReference.length > 256 ||
          !/^[^\s]+$/.test(item.settlementReference)) fail();
    } else if (item.settlementReference !== undefined) fail();

    const key = `${item.provider}:${item.kind}:${item.providerRecordId}`;
    const fingerprint = JSON.stringify([
      item.tenantId, item.product, item.provider, item.kind, item.environment,
      item.verification, item.windowStart, item.windowEnd, item.count ?? null,
      item.amountMinor ?? null, item.currency ?? null, item.settlementReference ?? null,
    ]);
    const priorSource = evidenceIdToSource.get(item.evidenceId);
    if (priorSource !== undefined && priorSource !== key) fail();
    evidenceIdToSource.set(item.evidenceId, key);
    if (unique.has(key)) {
      if (unique.get(key) !== fingerprint) fail();
      continue;
    }
    unique.set(key, fingerprint);
    if (item.environment !== "live" || item.verification !== "verified") {
      excluded++;
      continue;
    }
    if (item.kind === "paid_order") paidByProviderOrder.set(item.providerRecordId, item.amountMinor!);
    if (item.kind === "settled_order") settledByProviderOrder.set(item.providerRecordId, item.amountMinor!);
    totals[item.kind] = safeAdd(totals[item.kind] ?? 0,
      item.kind === "paid_order" || item.kind === "settled_order" ? 1 : money ? item.amountMinor! : item.count!);
  }
  // If both independently verified statuses refer to the same provider order,
  // reject contradictory amounts rather than counting impossible revenue.
  // Settled-only evidence is still permitted when the trusted adapter can
  // attest settlement without a separate paid-order record.
  for (const [orderId, paidAmount] of paidByProviderOrder) {
    const settledAmount = settledByProviderOrder.get(orderId);
    if (settledAmount !== undefined && settledAmount !== paidAmount) fail();
  }
  // Sum each verified order once per status. A paid charge is not a settled payout.
  // The same provider order can appear in both categories only when settlement
  // is independently attested by a trusted ingestion adapter.
  const sumRevenue = (kind: "paid_order" | "settled_order"): number | null => {
    let revenue: number | null = null;
    const seen = new Set<string>();
    for (const item of evidence) {
      if (item.kind !== kind || item.environment !== "live" ||
          item.verification !== "verified") continue;
      const key = `${item.provider}:${item.kind}:${item.providerRecordId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      revenue = safeAdd(revenue ?? 0, item.amountMinor!);
    }
    return revenue;
  };
  const paidRevenue = sumRevenue("paid_order");
  const settledRevenue = sumRevenue("settled_order");
  const visits = totals.qualified_visit_count ?? null;
  const orders = totals.settled_order ?? null;
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    qualifiedVisits: visits,
    qualifiedLeads: totals.qualified_lead_count ?? null,
    platformAttributedPurchaseEvents: totals.platform_purchase_event ?? null,
    paidOrders: totals.paid_order ?? null,
    grossPaidRevenueMinor: paidRevenue,
    settledOrders: orders,
    grossSettledRevenueMinor: settledRevenue,
    verifiedAdSpendMinor: totals.ad_spend ?? null,
    observedOrdersPerQualifiedVisit: visits !== null && visits > 0 && orders !== null
      ? orders / visits : null,
    cpaMinor: null,
    excludedTestOrUnverified: excluded,
    distinctEvidenceRecords: unique.size,
  });
}
