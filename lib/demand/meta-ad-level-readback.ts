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
const validDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !date.test(v)) return false;
  const ms = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v;
};
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

/** Action values are provider-attributed metadata, NEVER HitPay revenue.
 * Fingerprint all observed action counts and action_values so later Meta
 * revisions cannot reuse an earlier ad-level candidate ID. */
export function canonicalActionValues(input: unknown): readonly (readonly [string, string])[] | null {
  if (input === undefined) return null; // absent is not provider-reported zero
  if (!Array.isArray(input)) throw new Error("Invalid BROS DEMAND ad-level readback");
  if (input.length > 200) invalid();
  const values = new Map<string, string>();
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Invalid BROS DEMAND ad-level readback");
    const row = item as Record<string, unknown>;
    const actionType = row.action_type;
    if (typeof actionType !== "string" ||
        !/^[a-z0-9_.]{1,100}$/.test(actionType) ||
        (typeof row.value !== "string" && typeof row.value !== "number"))
      throw new Error("Invalid BROS DEMAND ad-level readback");
    const raw = String(row.value);
    if (!/^(0|[1-9]\d*)(?:\.\d{1,8})?$/.test(raw)) invalid();
    // Decimal string canonicalization avoids IEEE-754 rounding collisions:
    // 999999999999.00000001 and .00000002 are distinct provider revisions.
    const [whole, fractional = ""] = raw.split(".");
    const integerPart = Number(whole);
    if (!Number.isSafeInteger(integerPart) || integerPart > 1e12 ||
        (integerPart === 1e12 && /[1-9]/.test(fractional))) invalid();
    const trimmedFraction = fractional.replace(/0+$/, "");
    const normalized = trimmedFraction ? whole + "." + trimmedFraction : whole;
    const previous = values.get(actionType);
    if (previous !== undefined && previous !== normalized) invalid();
    values.set(actionType, normalized);
  }
  return [...values.entries()].sort(([a], [b]) => a.localeCompare(b));
}
export function reconcileDemandMetaAdReadback(
  scope: Scope, query: Query, response: Response, campaign: CampaignTotals,
) {
  if (!scope || !query || !response || !campaign ||
      // RegExp.test coerces arrays/objects: reject nonprimitive identities.
      typeof scope.tenantId !== "string" || !uuid.test(scope.tenantId) ||
      scope.product !== "demand" ||
      typeof scope.accountId !== "string" || !/^act_\d+$/.test(scope.accountId) ||
      typeof scope.campaignId !== "string" || !digits.test(scope.campaignId) ||
      scope.currency !== "MYR" ||
      !validDate(scope.since) || !validDate(scope.until) || scope.since > scope.until ||
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
    metaPurchaseSignal: number | null; purchaseAliasMismatch: boolean; actionEvidenceDigest: string}> = [];
  for (const row of response.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        typeof row.ad_id !== "string" || !digits.test(row.ad_id) || ids.has(row.ad_id) ||
        typeof row.adset_id !== "string" || !digits.test(row.adset_id) ||
        // HYPD exposes these when explicitly requested. Require both so an
        // account/currency mismatch cannot silently contaminate MYR totals.
        // A default Meta response omitting these identity fields is incomplete.
        row.account_id !== scope.accountId.slice(4) ||
        row.account_currency !== scope.currency ||
        row.campaign_id !== scope.campaignId ||
        row.date_start !== scope.since || row.date_stop !== scope.until ||
        typeof row.attribution_setting !== "string" ||
        !/^[a-z0-9_]{1,64}$/.test(row.attribution_setting)) invalid();
    const adId = row.ad_id as string;
    const adsetId = row.adset_id as string;
    const attributionSetting = row.attribution_setting as string;
    ids.add(adId);
    const s = minor(row.spend), i = integer(row.impressions), c = integer(row.inline_link_clicks);
    spendMinor += s; impressions += i; inlineLinkClicks += c;
    if (![spendMinor, impressions, inlineLinkClicks].every(Number.isSafeInteger)) invalid();
    if (row.actions !== undefined && (!Array.isArray(row.actions) || row.actions.length > 200)) invalid();
    const aliases = new Map<string, number>();
    const allActionCounts = new Map<string, number>();
    for (const a of (row.actions ?? []) as Array<Record<string, unknown>>) {
      if (!a || typeof a.action_type !== "string" ||
          !/^[a-z0-9_.]{1,100}$/.test(a.action_type)) invalid();
      const value = integer(a.value);
      const actionType = a.action_type as string;
      const previousCount = allActionCounts.get(actionType);
      if (previousCount !== undefined && previousCount !== value) invalid();
      allActionCounts.set(actionType, value);
      if (purchaseLabels.has(actionType)) {
        const previous = aliases.get(actionType);
        if (previous !== undefined && previous !== value) invalid();
        aliases.set(actionType, value);
      }
    }
    const values = [...aliases.values()];
    const mismatch = values.some(v => v !== values[0]);
    // The digest binds revisions of ALL action labels and attributed values,
    // including auxiliary MYR0.01 signals, without treating any as revenue.
    const actionEvidenceDigest = createHash("sha256").update(JSON.stringify([
      [...allActionCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
      canonicalActionValues(row.action_values),
    ])).digest("hex");
    adObservations.push({adId, adsetId,
      spendMinor: s, impressions: i, inlineLinkClicks: c,
      attributionSetting,
      metaPurchaseSignal: mismatch || values.length === 0 ? null : values[0],
      purchaseAliasMismatch: mismatch, actionEvidenceDigest});
  }
  adObservations.sort((a,b) => a.adId.localeCompare(b.adId));
  const totalsMatch = campaign.spendMinor !== null && campaign.impressions !== null &&
    campaign.inlineLinkClicks !== null && spendMinor === campaign.spendMinor &&
    impressions === campaign.impressions && inlineLinkClicks === campaign.inlineLinkClicks;
  const positiveSignalAds = adObservations.filter(a => (a.metaPurchaseSignal ?? 0) > 0)
    .map(a => ({adId: a.adId, reportedPurchaseAliases: a.metaPurchaseSignal,
      attributionSetting: a.attributionSetting}));
  const candidateId = "demand:meta-ad-readback:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v2", scope.tenantId.toLowerCase(), scope.accountId,
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
