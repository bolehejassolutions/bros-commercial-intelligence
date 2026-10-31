import { createHash } from "node:crypto";

/** DEMAND-only read-only Meta creative UTM cohort preflight.
 * Provider connection, tenant membership, live clicks and conversion attribution
 * must be verified independently by trusted server adapters. */
export type MetaUtmCohortScope = Readonly<{
  tenantId: string; accountId: string; campaignId: string;
  expectedCampaignAds: number;
}>;
export type MetaUtmCohortResponse = Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  nextPageToken: string | null;
  missingScopes: readonly string[] | null;
  droppedFields?: readonly string[] | null;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digits = /^\d+$/;
const labelToken = /^[a-z0-9_-]{2,100}$/i;
const fail = (): never => { throw new Error("Invalid BROS DEMAND Meta UTM cohort evidence"); };

export function assessDemandMetaUtmCohort(
  scope: MetaUtmCohortScope, response: MetaUtmCohortResponse,
) {
  if (!scope || !uuid.test(scope.tenantId) || !/^act_\d+$/.test(scope.accountId) ||
      !digits.test(scope.campaignId) || !Number.isSafeInteger(scope.expectedCampaignAds) ||
      scope.expectedCampaignAds < 2 || scope.expectedCampaignAds > 500 ||
      !response || !Array.isArray(response.rows) || response.rows.length > 500 ||
      response.nextPageToken !== null ||
      (response.missingScopes !== null &&
        (!Array.isArray(response.missingScopes) || response.missingScopes.length !== 0)) ||
      (response.droppedFields != null &&
        (!Array.isArray(response.droppedFields) || response.droppedFields.length !== 0))) fail();
  const campaignRows = response.rows.filter(row => row?.campaign_id === scope.campaignId);
  if (campaignRows.length !== scope.expectedCampaignAds) fail();
  const byLabel = new Map<string, string[]>();
  const ids = new Set<string>();
  const signatures: string[][] = [];
  const campaigns = new Set<string>();
  let macroCount = 0;
  for (const row of campaignRows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        typeof row.id !== "string" || !digits.test(row.id) || ids.has(row.id) ||
        !row.creative || typeof row.creative !== "object" || Array.isArray(row.creative)) fail();
    const adId = row.id as string;
    ids.add(adId);
    const creative = row.creative as Record<string, unknown>;
    if (typeof creative.id !== "string" || !digits.test(creative.id) ||
        typeof creative.url_tags !== "string" || creative.url_tags.length > 2048) fail();
    const creativeId = creative.id as string;
    const entries = [...new URLSearchParams(creative.url_tags as string).entries()];
    if (entries.length < 2 || entries.length > 24 ||
        entries.some(([k,v]) => !/^[a-z][a-z0-9_]{0,63}$/.test(k) || v.length > 250) ||
        new Set(entries.map(([k]) => k)).size !== entries.length) fail();
    const tags = new Map(entries);
    const label = tags.get("utm_content") ?? fail();
    const campaign = tags.get("utm_campaign") ?? fail();
    if (!label || !labelToken.test(label) || !campaign || !labelToken.test(campaign)) fail();
    campaigns.add(campaign);
    if (tags.get("ad_id") === "{{ad.id}}") macroCount++;
    byLabel.set(label, [...(byLabel.get(label) ?? []), adId]);
    signatures.push([adId, creativeId, label, campaign, tags.get("ad_id") ?? ""]);
  }
  const collisions = [...byLabel.entries()]
    .filter(([, adIds]) => adIds.length > 1)
    .map(([utmContent, adIds]) => Object.freeze({utmContent, adIds: Object.freeze(adIds.sort())}))
    .sort((a,b) => a.utmContent.localeCompare(b.utmContent));
  const snapshotId = "demand:meta-utm-cohort:sha256:" + createHash("sha256")
    .update(JSON.stringify([scope.tenantId.toLowerCase(), scope.accountId, scope.campaignId,
      scope.expectedCampaignAds, signatures.sort((a,b) => a[0].localeCompare(b[0]))]))
    .digest("hex");
  return Object.freeze({
    snapshotId, campaignId: scope.campaignId, inspectedAds: campaignRows.length,
    distinctUtmContentLabels: byLabel.size,
    collisions: Object.freeze(collisions),
    utmCampaignConsistent: campaigns.size === 1,
    allAdIdMacrosConfigured: macroCount === campaignRows.length,
    status: collisions.length ? "UTM_CONTENT_COLLISION_OBSERVED" as const :
      "NO_UTM_CONTENT_COLLISION_OBSERVED" as const,
    risk: collisions.length ? "LABEL_AMBIGUOUS_WHEN_AD_ID_NOT_CAPTURED" as const :
      "NO_LABEL_COLLISION_OBSERVED" as const,
    providerAuthenticationVerified: false as const,
    dynamicMacroExpansionVerified: false as const,
    firstPartyUtmCaptureVerified: false as const,
    hitpayOrderJoinVerified: false as const,
    verifiedOrders: null, verifiedCpaMinor: null, verifiedCacMinor: null,
    verifiedConversionRate: null, causalLift: null,
    durableBciLearningVerified: false as const, executionAllowed: false as const,
  });
}
