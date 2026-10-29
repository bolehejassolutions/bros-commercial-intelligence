import { createHash } from "node:crypto";

/** DEMAND-only read-only Meta ad→creative tracking template preflight.
 * Not app-owned provider attestation, real click, order attribution or BCI write. */
export type CreativeScope = Readonly<{
  tenantId: string; product: "demand"; accountId: string; campaignId: string;
  adId: string; expectedLandingUrl: string; expectedUtmCampaign: string;
  expectedUtmContent: string;
}>;
export type CreativeReadback = Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  nextPageToken: string | null; missingScopes: readonly string[] | null;
  droppedFields?: readonly string[] | null;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digits = /^\d+$/;
const token = /^[a-z0-9_-]{2,100}$/i;
const fail = (): never => { throw new Error("Invalid BROS DEMAND Meta creative tracking evidence"); };
const required = ["ad_id","adset_id","campaign_id","utm_campaign","utm_content","utm_medium","utm_source"] as const;
export function assessDemandMetaCreativeTracking(
  scope: CreativeScope, ad: Readonly<Record<string, unknown>>, response: CreativeReadback,
) {
  if (!scope || typeof scope.tenantId !== "string" || !uuid.test(scope.tenantId) ||
      scope.product !== "demand" || typeof scope.accountId !== "string" ||
      !/^act_\d+$/.test(scope.accountId) || typeof scope.campaignId !== "string" ||
      !digits.test(scope.campaignId) || typeof scope.adId !== "string" ||
      !digits.test(scope.adId) || typeof scope.expectedUtmCampaign !== "string" ||
      !token.test(scope.expectedUtmCampaign) || typeof scope.expectedUtmContent !== "string" ||
      !token.test(scope.expectedUtmContent) || typeof scope.expectedLandingUrl !== "string" ||
      !ad || typeof ad !== "object" || Array.isArray(ad) ||
      ad.id !== scope.adId || ad.campaign_id !== scope.campaignId ||
      typeof ad.adset_id !== "string" || !digits.test(ad.adset_id) ||
      !ad.creative || typeof ad.creative !== "object" || Array.isArray(ad.creative) ||
      typeof (ad.creative as Record<string, unknown>).id !== "string" ||
      !digits.test((ad.creative as Record<string, unknown>).id as string) ||
      typeof ad.status !== "string" || typeof ad.effective_status !== "string" ||
      !/^[A-Z_]{2,50}$/.test(ad.status) || !/^[A-Z_]{2,50}$/.test(ad.effective_status) ||
      !response || !Array.isArray(response.rows) || response.rows.length !== 1 ||
      response.nextPageToken !== null ||
      (response.missingScopes !== null &&
        (!Array.isArray(response.missingScopes) || response.missingScopes.length !== 0)) ||
      (response.droppedFields != null &&
        (!Array.isArray(response.droppedFields) || response.droppedFields.length !== 0))) fail();
  const creative = response.rows[0];
  if (!creative || typeof creative !== "object" || Array.isArray(creative) ||
      creative.id !== (ad.creative as Record<string, unknown>).id ||
      typeof creative.url_tags !== "string" || creative.url_tags.length > 2048 ||
      !creative.object_story_spec || typeof creative.object_story_spec !== "object" ||
      Array.isArray(creative.object_story_spec)) fail();
  const linkData = (creative.object_story_spec as Record<string, unknown>).link_data;
  if (!linkData || typeof linkData !== "object" || Array.isArray(linkData) ||
      typeof (linkData as Record<string, unknown>).link !== "string") fail();
  let expected: URL, landing: URL;
  try {
    expected = new URL(scope.expectedLandingUrl);
    landing = new URL((linkData as Record<string, unknown>).link as string);
  } catch { return fail(); }
  if (expected.protocol !== "https:" || expected.username || expected.password ||
      expected.search || expected.hash || expected.port ||
      landing.protocol !== "https:" || landing.username || landing.password ||
      landing.port || landing.hash || landing.search ||
      landing.origin !== expected.origin || landing.pathname !== expected.pathname) fail();
  const entries = [...new URLSearchParams(creative.url_tags as string).entries()];
  if (entries.length === 0 || entries.length > 24 ||
      entries.some(([key,value]) => !/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
        value.length > 250) ||
      new Set(entries.map(([key]) => key)).size !== entries.length) fail();
  const tags = new Map(entries);
  const expectedTags: Record<string,string> = {
    ad_id:"{{ad.id}}", adset_id:"{{adset.id}}", campaign_id:"{{campaign.id}}",
    utm_campaign:scope.expectedUtmCampaign, utm_content:scope.expectedUtmContent,
    utm_medium:"paid_social", utm_source:"{{site_source_name}}",
  };
  const missingOrMismatchedTags = required.filter(key => tags.get(key) !== expectedTags[key]);
  const extraTags = entries.map(([key]) => key)
    .filter(key => !required.includes(key as typeof required[number])).sort();
  const trackingTemplateReady = missingOrMismatchedTags.length === 0 && extraTags.length === 0;
  const snapshotId = "demand:meta-creative-tracking:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v2",scope.tenantId.toLowerCase(),scope.product,
      scope.accountId,scope.campaignId,scope.adId,scope.expectedLandingUrl,
      scope.expectedUtmCampaign,scope.expectedUtmContent,
      ad.adset_id,creative.id,ad.status,ad.effective_status,landing.href,
      entries.sort(([a],[b]) => a.localeCompare(b))])).digest("hex");
  return Object.freeze({
    snapshotId, status: trackingTemplateReady ? "TEMPLATE_READY_UNATTESTED" as const :
      "TEMPLATE_INCOMPLETE_UNATTESTED" as const,
    adId:scope.adId, creativeId:creative.id as string,
    configuredStatus:ad.status as string, effectiveStatus:ad.effective_status as string,
    landingUrl:landing.href, missingOrMismatchedTags:Object.freeze(missingOrMismatchedTags),
    extraTags:Object.freeze(extraTags), trackingTemplateReady,
    dynamicTokenExpansionVerified:false as const,
    liveClickOrFbclidVerified:false as const,
    landingToCheckoutUtmPersistenceVerified:false as const,
    hitpayEventToOrderJoinVerified:false as const,
    providerAuthenticationVerified:false as const,
    tenantMembershipVerified:false as const, adServingVerified:false as const,
    experimentActionVerified:false as const, verifiedOrders:null,
    verifiedCpaMinor:null, verifiedCacMinor:null, verifiedConversionRate:null,
    causalLift:null, durableBciLearningVerified:false as const,
    executionAllowed:false as const,
  });
}
