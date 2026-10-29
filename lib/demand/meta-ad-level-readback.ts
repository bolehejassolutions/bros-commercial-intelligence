import { createHash } from "node:crypto";

/** DEMAND-only Meta ad-level observation. No app authentication, provider attestation,
 * verified purchase, causal attribution, action execution or BCI writes. */
type Scope = Readonly<{
  tenantId: string; product: "demand"; accountId: string; campaignId: string;
  since: string; until: string; currency: "MYR";
}>;
type Query = Readonly<{
  accountId: string; objectId: string; level: "ad"; since: string; until: string;
}>;
type Response = Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  nextPageToken: string | null;
  missingScopes: readonly string[] | null;
  droppedFields?: readonly string[] | null;
}>;
type CampaignTotals = Readonly<{
  spendMinor: number | null; impressions: number | null;
  inlineLinkClicks: number | null; metaAttributedPurchases: number | null;
}>;
const invalid = (): never => { throw new Error("Invalid BROS DEMAND ad-level readback"); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digits = /^\d+$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
function integer(v: unknown): number {
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
      Math.round(n * 100) / 100 !== n) invalid();
  return Math.round(n * 100);
}
const purchaseLabels = new Set(["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
export function reconcileDemandMetaAdReadback(
  scope: Scope, query: Query, response: Response, campaign: CampaignTotals,
) {
  if (!scope || !query || !response || !campaign || !uuid.test(scope.tenantId) ||
      scope.product !== "demand" || !/^act_\d+$/.test(scope.accountId) ||
      !digits.test(scope.campaignId) || scope.currency !== "MYR" ||
      !date.test(scope.since) || !date.test(scope.until) || scope.since > scope.until ||
      query.accountId !== scope.accountId || query.objectId !== scope.campaignId ||
      query.level !== "ad" || query.since !== scope.since || query.until !== scope.until ||
      !Array.isArray(response.rows) || response.rows.length === 0 ||
      response.nextPageToken !== null ||
      (response.missingScopes !== null && (!Array.isArray(response.missingScopes) || response.missingScopes.length > 0)) ||
      (response.droppedFields != null && (!Array.isArray(response.droppedFields) || response.droppedFields.length > 0))) invalid();
  const ids = new Set<string>();
  let spendMinor = 0, impressions = 0, inlineLinkClicks = 0;
  const adObservations: Array<{adId: string; adsetId: string; spendMinor: number;
    impressions: number; inlineLinkClicks: number; attributionSetting: string;
    metaPurchaseSignal: number | null; purchaseAliasMismatch: boolean}> = [];
  for (const row of response.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        typeof row.ad_id !== "string" || !digits.test(row.ad_id) || ids.has(row.ad_id) ||
        typeof row.adset_id !== "string" || !digits.test(row.adset_id) ||
        row.campaign_id !== scope.campaignId ||
        row.date_start !== scope.since || row.date_stop !== scope.until ||
        typeof row.attribution_setting !== "string" ||
        !/^[a-z0-9_]{1,64}$/.test(row.attribution_setting)) invalid();
    ids.add(row.ad_id);
    const s = minor(row.spend), i = integer(row.impressions), c = integer(row.inline_link_clicks);
    spendMinor += s; impressions += i; inlineLinkClicks += c;
    if (![spendMinor, impressions, inlineLinkClicks].every(Number.isSafeInteger)) invalid();
    if (row.actions !== undefined && (!Array.isArray(row.actions) || row.actions.length > 200)) invalid();
    const aliases = new Map<string, number>();
    for (const a of (row.actions ?? []) as Array<Record<string, unknown>>) {
      if (!a || typeof a.action_type !== "string" ||
          !/^[a-z0-9_.]{1,100}$/.test(a.action_type)) invalid();
      const value = integer(a.value);
      if (purchaseLabels.has(a.action_type)) {
        const previous = aliases.get(a.action_type);
        if (previous !== undefined && previous !== value) invalid();
        aliases.set(a.action_type, value);
      }
    }
    const values = [...aliases.values()];
    const mismatch = values.some(v => v !== values[0]);
    adObservations.push({adId: row.ad_id, adsetId: row.adset_id,
      spendMinor: s, impressions: i, inlineLinkClicks: c,
      attributionSetting: row.attribution_setting,
      metaPurchaseSignal: mismatch || values.length === 0 ? null : values[0],
      purchaseAliasMismatch: mismatch});
  }
  adObservations.sort((a,b) => a.adId.localeCompare(b.adId));
  const totalsMatch = campaign.spendMinor !== null && campaign.impressions !== null &&
    campaign.inlineLinkClicks !== null && spendMinor === campaign.spendMinor &&
    impressions === campaign.impressions && inlineLinkClicks === campaign.inlineLinkClicks;
  const positiveSignalAds = adObservations.filter(a => (a.metaPurchaseSignal ?? 0) > 0)
    .map(a => ({adId: a.adId, reportedPurchaseAliases: a.metaPurchaseSignal,
      attributionSetting: a.attributionSetting}));
  const candidateId = "demand:meta-ad-readback:sha256:" + createHash("sha256")
    .update(JSON.stringify([scope.tenantId.toLowerCase(), scope.accountId,
      scope.campaignId, scope.since, scope.until, campaign, adObservations]))
    .digest("hex");
  return Object.freeze({candidateId, status: "AD_LEVEL_OBSERVED_UNATTESTED" as const,
    adCount: adObservations.length, adTotalsMatchCampaign: totalsMatch,
    adSpendMinor: spendMinor, adImpressions: impressions, adInlineLinkClicks: inlineLinkClicks,
    positiveSignalAds: Object.freeze(positiveSignalAds.map(a => Object.freeze(a))),
    incompletePurchaseActionCoverage: adObservations.some(a => a.metaPurchaseSignal === null),
    attributionWindowIsNotClickPath: true as const,
    // Ad-specific spend / one Meta-attributed Purchase is not customer CPA.
    verifiedOrders: null, verifiedCpaMinor: null, verifiedCacMinor: null,
    verifiedConversionRate: null, causalLift: null,
    providerAuthenticationVerified: false as const,
    tenantMembershipVerified: false as const,
    actionExecuted: false as const, outcomeVerified: false as const,
    learningVerified: false as const, executionAllowed: false as const,
  });
}
