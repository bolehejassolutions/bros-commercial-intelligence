import { createHash } from "node:crypto";
/**
 * BROS DEMAND internal, read-only Meta Ads campaign funnel projection.
 *
 * Caller supplies a trusted, separately authenticated provider response and
 * server-derived tenant scope. This pure adapter is NOT provider attestation,
 * acquisition attribution, a BCI ledger writer or an ad-execution capability.
 * Meta purchase, omni_purchase, and pixel purchase are overlapping
 * action labels; NEVER sum them as independent sales.
 */
export type MetaAction = Readonly<{ action_type: string; value: string | number }>;
export type MetaCampaignInsight = Readonly<{
  campaign_id: string;
  date_start: string;
  date_stop: string;
  spend?: string | number;
  impressions?: string | number;
  reach?: string | number;
  clicks?: string | number;
  inline_link_clicks?: string | number;
  actions?: readonly MetaAction[];
}>;
export type MetaFunnelScope = Readonly<{
  tenantId: string; // authenticated product adapter, never client asserted
  product: "demand";
  accountId: string;
  campaignId: string;
  currency: "MYR";
  since: string; // inclusive Meta report dates
  until: string;
  collectedAt: string; // UTC collection timestamp
}>;
export type MetaFunnelObservation = Readonly<{
  sourceKey: string;
  /** Immutable projected-snapshot identity; sourceKey remains the campaign/window grouping key. */
  snapshotKey: string;
  tenantId: string;
  product: "demand";
  provider: "meta_ads";
  accountId: string;
  campaignId: string;
  windowStart: string;
  windowEndInclusive: string;
  collectedAt: string;
  /** MYT calendar status only; past day is NOT provider-final attribution. */
  calendarWindowStatus: "CURRENT_MYT_DAY" | "PAST_MYT_DAY";
  currency: "MYR";
  spendMinor: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  inlineLinkClicks: number | null;
  landingPageViews: number | null;
  metaAttributedPurchases: number | null;
  pixelPurchaseEvents: number | null;
  actionAliasMismatch: boolean;
  observedLandingPageViewsPerInlineLinkClick: number | null;
  /** These cannot be inferred from Meta actions or landing-page views. */
  qualifiedVisits: null;
  qualifiedLeads: null;
  hitpayPaidOrders: null;
  hitpaySettledOrders: null;
  verifiedCacMinor: null;
  causalLift: null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const fail = (): never => { throw new Error("Invalid BROS DEMAND Meta insight"); };
function validDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATE.exec(v);
  if (!m) return false;
  const t = Date.parse(v + "T00:00:00.000Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}
function validUtc(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = UTC.exec(v);
  if (!m || !validDate(m[1]) || Number(m[2]) > 23 ||
      Number(m[3]) > 59 || Number(m[4]) > 59) return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 19) === v.slice(0, 19);
}
function count(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" && (typeof v !== "string" || !/^(0|[1-9]\d*)$/.test(v))) fail();
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) fail();
  return n;
}
function money(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" && (typeof v !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(v))) fail();
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100)) ||
      Math.round(n * 100) / 100 !== n) fail();
  return Math.round(n * 100);
}
export function normalizeMetaCampaignFunnel(
  scope: MetaFunnelScope, row: MetaCampaignInsight,
): MetaFunnelObservation {
  if (!scope || !row || typeof scope.tenantId !== "string" ||
      !UUID.test(scope.tenantId) || scope.product !== "demand" ||
      typeof scope.accountId !== "string" || !/^act_\d+$/.test(scope.accountId) ||
      typeof scope.campaignId !== "string" || !/^\d+$/.test(scope.campaignId) ||
      typeof row.campaign_id !== "string" ||
      scope.currency !== "MYR" || !validDate(scope.since) || !validDate(scope.until) ||
      scope.since > scope.until || !validUtc(scope.collectedAt) ||
      row.campaign_id !== scope.campaignId || row.date_start !== scope.since ||
      row.date_stop !== scope.until ||
      (row.actions !== undefined && (!Array.isArray(row.actions) || row.actions.length > 200))) fail();

  // Meta account is Asia/Kuala_Lumpur (UTC+08:00, no DST). The UTC
  // collection date alone is incorrect near local midnight. Reject a report
  // ending in the future local day; never label an ongoing day as closed.
  // A past calendar day can still be revised by Meta attribution later.
  // DEMAND_META_FUTURE_COLLECTION_GUARD_20261028: a caller-provided collection
  // timestamp is NOT a provider receipt. Reject observations dated materially
  // after the executing clock; otherwise a forged future collection date can
  // make an unobserved reporting day appear complete in MYT and can enter a
  // synthetic experiment baseline. Five minutes allows bounded clock skew;
  // the BCI worker must still attest collection time and source independently.
  if (Date.parse(scope.collectedAt) > Date.now() + 5 * 60 * 1000) fail();
  const collectedMytDate = new Date(Date.parse(scope.collectedAt) + 8 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  if (collectedMytDate < scope.since || scope.until > collectedMytDate) fail();

  const actions = new Map<string, number>();
  for (const action of row.actions ?? []) {
    if (!action || typeof action.action_type !== "string" ||
        !/^[a-z0-9_.]{1,100}$/.test(action.action_type)) fail();
    const value = count(action.value);
    if (value === null) fail();
    const previous = actions.get(action.action_type);
    if (previous !== undefined && previous !== value) fail();
    actions.set(action.action_type, value ?? fail());
  }
  const get = (name: string): number | null => actions.get(name) ?? null;
  const generic = get("purchase"), omni = get("omni_purchase");
  const pixel = get("offsite_conversion.fb_pixel_purchase");
  // Compare every present purchase alias, including omni vs pixel when the
  // generic purchase action is missing. These are overlapping labels, not sales.
  const purchaseAliases = [generic, omni, pixel].filter((v): v is number => v !== null);
  const mismatch = purchaseAliases.some(v => v !== purchaseAliases[0]);
  const inline = count(row.inline_link_clicks);
  const lpv = get("landing_page_view");
  // Campaign/window identity is stable, but Meta may revise a report for the
  // same window. Never overwrite an earlier projected snapshot by sourceKey.
  // Use snapshotKey for immutable candidate snapshots; neither key attests
  // provider authentication, tenant membership, settlement or BCI persistence.
  const sourceKey = "meta_ads:tenant:" + scope.tenantId.toLowerCase() + ":" +
    scope.accountId + ":campaign:" + scope.campaignId + ":" + scope.since + ":" + scope.until;
  const spendMinor = money(row.spend);
  const impressions = count(row.impressions), reach = count(row.reach);
  const clicks = count(row.clicks);
  const attributed = mismatch ? null : generic;
  const pixelEvents = mismatch ? null : pixel;
  const snapshotFields = [spendMinor, impressions, reach, clicks, inline, lpv,
    attributed, pixelEvents, mismatch ? 1 : 0];
  // DEMAND_META_ACTION_SNAPSHOT_INTEGRITY_20261027: derived metrics can
  // collide when two different raw Meta action reports both fail closed
  // (e.g. conflicting purchase aliases), or when an unprojected action
  // changes. Fingerprint every normalized action label/value, independent
  // of provider array order or identical duplicate labels. This is an
  // observation identity, NOT a provider signature or verified sale.
  const normalizedActionDigest = createHash("sha256")
    .update(JSON.stringify([...actions.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0)))
    .digest("hex");
  // DEMAND_META_BOUNDED_SNAPSHOT_KEY_20261027: immutable evidence identity
  // is content-addressed, not collection-time-addressed. A provider report
  // reread unchanged must not create a second BCI audit candidate. Hashing
  // sourceKey keeps tenant/account/campaign/window separation, while all
  // normalized metrics and actions retain revision sensitivity (null != 0).
  // This bounded 80-character key fits BCI's 256-char parser and Neon DEV's
  // 250-char provider_record_key constraint; it is NOT provider attestation.
  const snapshotKey = "meta_ads:sha256:" + createHash("sha256")
    .update(JSON.stringify({ sourceKey, snapshotFields, normalizedActionDigest }))
    .digest("hex");
  return Object.freeze({
    sourceKey, snapshotKey,
    tenantId: scope.tenantId, product: "demand" as const, provider: "meta_ads" as const,
    accountId: scope.accountId, campaignId: scope.campaignId,
    windowStart: scope.since, windowEndInclusive: scope.until,
    collectedAt: scope.collectedAt,
    calendarWindowStatus: scope.until === collectedMytDate
      ? "CURRENT_MYT_DAY" as const : "PAST_MYT_DAY" as const,
    currency: "MYR" as const,
    spendMinor, impressions, reach, clicks, inlineLinkClicks: inline,
    landingPageViews: lpv,
    // Ambiguous alias counts fail closed rather than silently choosing a winner.
    metaAttributedPurchases: attributed,
    pixelPurchaseEvents: pixelEvents,
    actionAliasMismatch: mismatch,
    observedLandingPageViewsPerInlineLinkClick: lpv !== null && inline !== null && inline > 0
      ? lpv / inline : null,
    qualifiedVisits: null, qualifiedLeads: null, hitpayPaidOrders: null,
    hitpaySettledOrders: null, verifiedCacMinor: null, causalLift: null,
  });
}
