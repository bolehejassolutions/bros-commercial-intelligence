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
  // Meta's dynamic-creative UGC ads store destination links in
  // asset_feed_spec.link_urls, not object_story_spec.link_data. A direct-link
  // only validator rejects valid provider rows and hides placement link risks.
  // Accept either provider shape, never both, and fail closed if ANY dynamic
  // link or customization-rule label cannot be resolved to the expected URL.
  const story = creative.object_story_spec as Record<string, unknown>;
  const feed = creative.asset_feed_spec;
  const directPresent = Object.hasOwn(story, "link_data");
  const feedPresent = !!feed && typeof feed === "object" && !Array.isArray(feed) &&
    Object.hasOwn(feed, "link_urls");
  if (directPresent === feedPresent) fail();
  const landingStrings: string[] = [];
  let feedLinkAudit: readonly unknown[] | null = null;
  if (directPresent) {
    const linkData = story.link_data;
    if (!linkData || typeof linkData !== "object" || Array.isArray(linkData) ||
        typeof (linkData as Record<string, unknown>).link !== "string") fail();
    landingStrings.push((linkData as Record<string, unknown>).link as string);
  } else {
    const spec = feed as Record<string, unknown>;
    const links = spec.link_urls as unknown[];
    const rules = spec.asset_customization_rules as unknown[];
    if (!Array.isArray(links) || links.length < 1 || links.length > 20 ||
        !Array.isArray(rules) || rules.length < 1 || rules.length > 30) fail();
    const labelKeys = new Set<string>();
    const linkAudit: string[] = [];
    for (const item of links) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail();
      const link = item as Record<string, unknown>;
      if (typeof link.website_url !== "string" ||
          !Array.isArray(link.adlabels) || link.adlabels.length < 1 ||
          link.adlabels.length > 20) fail();
      landingStrings.push(link.website_url as string);
      for (const value of link.adlabels as unknown[]) {
        if (!value || typeof value !== "object" || Array.isArray(value)) fail();
        const label = value as Record<string, unknown>;
        if (typeof label.name !== "string" ||
            !/^[a-z0-9_]{3,100}$/i.test(label.name) ||
            typeof label.id !== "string" || !digits.test(label.id)) fail();
        const key = label.name + "#" + label.id;
        if (labelKeys.has(key)) fail();
        labelKeys.add(key);
        linkAudit.push(key + "=" + link.website_url);
      }
    }
    const ruleAudit: string[] = [];
    for (const value of rules) {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail();
      const label = (value as Record<string, unknown>).link_url_label;
      if (!label || typeof label !== "object" || Array.isArray(label)) fail();
      const name = (label as Record<string, unknown>).name;
      const id = (label as Record<string, unknown>).id;
      if (typeof name !== "string" || typeof id !== "string" ||
          !labelKeys.has(name + "#" + id)) fail();
      ruleAudit.push(name + "#" + id);
    }
    feedLinkAudit = [linkAudit.sort(), ruleAudit.sort()];
  }
  let expected: URL, landing: URL, landingUrls: URL[];
  try {
    expected = new URL(scope.expectedLandingUrl);
    landingUrls = landingStrings.map(value => new URL(value));
    landing = landingUrls[0];
  } catch { return fail(); }
  if (expected.protocol !== "https:" || expected.username || expected.password ||
      expected.search || expected.hash || expected.port ||
      landingUrls.length < 1 || landingUrls.some(url =>
        url.protocol !== "https:" || url.username || url.password ||
        url.port || url.hash || url.search ||
        url.origin !== expected.origin || url.pathname !== expected.pathname)) fail();
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
    .update(JSON.stringify([feedPresent ? "v3-asset-feed" : "v2",scope.tenantId.toLowerCase(),scope.product,
      scope.accountId,scope.campaignId,scope.adId,scope.expectedLandingUrl,
      scope.expectedUtmCampaign,scope.expectedUtmContent,
      ad.adset_id,creative.id,ad.status,ad.effective_status,landing.href,
      entries.sort(([a],[b]) => a.localeCompare(b)),
      ...(feedPresent ? [feedLinkAudit] : [])])).digest("hex");
  return Object.freeze({
    snapshotId, status: trackingTemplateReady ? "TEMPLATE_READY_UNATTESTED" as const :
      "TEMPLATE_INCOMPLETE_UNATTESTED" as const,
    adId:scope.adId, creativeId:creative.id as string,
    configuredStatus:ad.status as string, effectiveStatus:ad.effective_status as string,
    landingUrl:landing.href, landingUrlSource:feedPresent ? "asset_feed_spec" as const : "link_data" as const,
    missingOrMismatchedTags:Object.freeze(missingOrMismatchedTags),
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
