import { createHash } from "node:crypto";

/** DEMAND-only read-only placement observation. A Meta-reported conversion action
 * is not a click path, unique paid order, bank settlement, or causal outcome. */
type Scope = Readonly<{
  tenantId: string; product: "demand"; accountId: string;
  campaignId: string; adId: string; since: string; until: string; currency: "MYR";
}>;
type Query = Readonly<{
  accountId: string; objectId: string; level: "ad"; since: string; until: string;
  breakdowns: readonly string[];
}>;
type Response = Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  nextPageToken: string | null;
  missingScopes: readonly string[] | null;
  droppedFields?: readonly string[] | null;
}>;
type AdTotals = Readonly<{
  spendMinor: number; impressions: number; inlineLinkClicks: number;
}>;
const invalid = (): never => { throw new Error("Invalid BROS DEMAND Meta placement readback"); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digits = /^\d+$/;
const platforms = new Set(["facebook", "instagram", "audience_network", "messenger", "threads", "whatsapp"]);
const purchaseLabels = new Set(["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function whole(v: unknown): number {
  if ((typeof v !== "string" && typeof v !== "number") ||
      (typeof v === "string" && !/^(0|[1-9]\d*)$/.test(v))) invalid();
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) invalid();
  return n;
}
function minor(v: unknown): number {
  if ((typeof v !== "string" && typeof v !== "number") ||
      (typeof v === "string" && !/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(v))) invalid();
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100)) ||
      Math.abs(Math.round(n * 100) / 100 - n) > 1e-9) invalid();
  return Math.round(n * 100);
}

export function reconcileDemandMetaPlacementReadback(
  scope: Scope, query: Query, response: Response, adTotals: AdTotals,
) {
  if (!scope || typeof scope.tenantId !== "string" || !uuid.test(scope.tenantId) ||
      scope.product !== "demand" || typeof scope.accountId !== "string" ||
      !/^act_\d+$/.test(scope.accountId) || typeof scope.campaignId !== "string" ||
      !digits.test(scope.campaignId) || typeof scope.adId !== "string" ||
      !digits.test(scope.adId) || scope.currency !== "MYR" ||
      !validDate(scope.since) || !validDate(scope.until) || scope.since > scope.until ||
      !query || query.accountId !== scope.accountId || query.objectId !== scope.adId ||
      query.level !== "ad" || query.since !== scope.since || query.until !== scope.until ||
      !Array.isArray(query.breakdowns) || query.breakdowns.length !== 1 ||
      query.breakdowns[0] !== "publisher_platform" || !response ||
      !Array.isArray(response.rows) || response.rows.length === 0 || response.rows.length > 20 ||
      response.nextPageToken !== null ||
      (response.missingScopes !== null && (!Array.isArray(response.missingScopes) || response.missingScopes.length > 0)) ||
      (response.droppedFields != null && (!Array.isArray(response.droppedFields) || response.droppedFields.length > 0)) ||
      !adTotals || ![adTotals.spendMinor, adTotals.impressions, adTotals.inlineLinkClicks]
        .every(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0)) invalid();
  const seen = new Set<string>();
  let spendMinor = 0, impressions = 0, inlineLinkClicks = 0;
  const observations: Array<{
    platform: string; spendMinor: number; impressions: number; inlineLinkClicks: number;
    reportedPurchaseAliases: number | null; purchaseAliasConflict: boolean;
  }> = [];
  for (const row of response.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        typeof row.publisher_platform !== "string" || !platforms.has(row.publisher_platform as string) ||
        seen.has(row.publisher_platform as string) || row.account_currency !== scope.currency ||
        row.ad_id !== scope.adId || row.campaign_id !== scope.campaignId ||
        typeof row.adset_id !== "string" || !digits.test(row.adset_id) ||
        row.date_start !== scope.since || row.date_stop !== scope.until) invalid();
    const platform = row.publisher_platform as string;
    seen.add(platform);
    const s = minor(row.spend), i = whole(row.impressions), c = whole(row.inline_link_clicks);
    spendMinor += s; impressions += i; inlineLinkClicks += c;
    if (![spendMinor, impressions, inlineLinkClicks].every(Number.isSafeInteger)) invalid();
    if (row.actions !== undefined && (!Array.isArray(row.actions) || row.actions.length > 200)) invalid();
    const aliases = new Map<string, number>();
    for (const action of (row.actions ?? []) as unknown[]) {
      if (!action || typeof action !== "object" || Array.isArray(action)) invalid();
      const a = action as Record<string, unknown>;
      if (typeof a.action_type !== "string" || !/^[a-z0-9_.]{1,100}$/.test(a.action_type)) invalid();
      const v = whole(a.value);
      if (purchaseLabels.has(a.action_type as string)) {
        if (aliases.has(a.action_type as string) && aliases.get(a.action_type as string) !== v) invalid();
        aliases.set(a.action_type as string, v);
      }
    }
    const values = [...aliases.values()];
    const conflict = values.some(v => v !== values[0]);
    observations.push({platform, spendMinor: s, impressions: i, inlineLinkClicks: c,
      reportedPurchaseAliases: conflict || values.length === 0 ? null : values[0],
      purchaseAliasConflict: conflict});
  }
  observations.sort((a,b) => a.platform.localeCompare(b.platform));
  const totalsMatch = spendMinor === adTotals.spendMinor &&
    impressions === adTotals.impressions && inlineLinkClicks === adTotals.inlineLinkClicks;
  const candidateId = "demand:meta-placement:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1",scope.tenantId.toLowerCase(),scope.product,
      scope.accountId,scope.campaignId,scope.adId,scope.since,scope.until,
      scope.currency,adTotals,observations])).digest("hex");
  return Object.freeze({
    candidateId,
    status: totalsMatch ? "PLACEMENT_TOTALS_MATCH_UNATTESTED" as const :
      "PLACEMENT_TOTALS_MISMATCH_UNATTESTED" as const,
    placementCount: observations.length, adTotalsMatch: totalsMatch,
    observedSpendMinor: spendMinor, observedImpressions: impressions,
    observedInlineLinkClicks: inlineLinkClicks,
    placementObservations: Object.freeze(observations.map(o => Object.freeze(o))),
    positiveAttributedPurchasePlacements: Object.freeze(observations
      .filter(o => o.reportedPurchaseAliases !== null && o.reportedPurchaseAliases > 0)
      .map(o => Object.freeze({platform:o.platform, reportedPurchaseAliases:o.reportedPurchaseAliases}))),
    purchaseActionCoverageIncomplete: observations.some(o => o.reportedPurchaseAliases === null),
    // A placement with one click and one attributed Purchase is NOT a click-to-order join.
    clickToOrderVerified: false as const, providerAuthenticationVerified: false as const,
    tenantMembershipVerified: false as const, verifiedOrders: null,
    verifiedCpaMinor: null, verifiedCacMinor: null, verifiedConversionRate: null,
    causalLift: null, actionExecuted: false as const, outcomeVerified: false as const,
    durableBciLearningVerified: false as const, executionAllowed: false as const,
  });
}
