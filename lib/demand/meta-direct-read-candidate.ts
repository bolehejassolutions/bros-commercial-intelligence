import { createHash } from "node:crypto";
import type { MetaFunnelScope, MetaFunnelObservation } from "./meta-insights-funnel.ts";

/**
 * Non-persistent, UNATTESTED candidate for a later BCI trusted ingestion.
 * Created only after the caller's signed-identity, active DEMAND membership,
 * pinned Meta read, and membership recheck have completed.
 *
 * Candidate key = stable content/window identity, NOT a provider signature,
 * authentication receipt, settled order, spending permission or DB row.
 * In particular, an empty Meta Insights response contains NO zero metrics.
 */
export type DemandMetaReadStatus =
  "NO_ROWS_NOT_ZERO" | "CAMPAIGN_ROW_OBSERVED_UNATTESTED";
type MetricSet = Readonly<{
  spendMinor: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  inlineLinkClicks: number | null;
  landingPageViews: number | null;
  metaAttributedPurchases: number | null;
  pixelPurchaseEvents: number | null;
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const day = /^\d{4}-\d{2}-\d{2}$/;
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const deny = (): never => { throw new Error("Invalid DEMAND Meta read candidate"); };
const validDay = (x: unknown): x is string =>
  typeof x === "string" && day.test(x) &&
  Number.isFinite(Date.parse(x + "T00:00:00Z")) &&
  new Date(Date.parse(x + "T00:00:00Z")).toISOString().slice(0, 10) === x;

export function prepareDemandMetaReadCandidate(
  scope: MetaFunnelScope,
  status: DemandMetaReadStatus,
  observation: MetaFunnelObservation | null,
) {
  if (!scope || typeof scope !== "object" || !uuid.test(scope.tenantId) ||
      scope.product !== "demand" || !/^act_[0-9]+$/.test(scope.accountId) ||
      !/^[0-9]+$/.test(scope.campaignId) || scope.currency !== "MYR" ||
      !validDay(scope.since) || !validDay(scope.until) || scope.since > scope.until ||
      typeof scope.collectedAt !== "string" || !iso.test(scope.collectedAt) ||
      !Number.isFinite(Date.parse(scope.collectedAt)) ||
      new Date(Date.parse(scope.collectedAt)).toISOString().replace(".000Z", "Z") !== scope.collectedAt) deny();

  if (status !== "NO_ROWS_NOT_ZERO" && status !== "CAMPAIGN_ROW_OBSERVED_UNATTESTED") deny();
  if ((status === "NO_ROWS_NOT_ZERO" && observation !== null) ||
      (status === "CAMPAIGN_ROW_OBSERVED_UNATTESTED" &&
       (!observation || observation.provider !== "meta_ads" ||
        observation.product !== "demand" ||
        observation.tenantId !== scope.tenantId.toLowerCase() ||
        observation.accountId !== scope.accountId ||
        observation.campaignId !== scope.campaignId ||
        observation.windowStart !== scope.since ||
        observation.windowEndInclusive !== scope.until ||
        observation.currency !== scope.currency ||
        observation.collectedAt !== scope.collectedAt ||
        !/^meta_ads:sha256:[0-9a-f]{64}$/.test(observation.snapshotKey)))) deny();

  // Do not hash the read timestamp: identical campaign content on different
  // collection attempts has one logical candidate key, with each read retaining
  // its own collectedAt. BCI must independently attest any persisted receipt.
  const candidateKey = "demand:meta-read:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1", scope.tenantId.toLowerCase(), scope.accountId,
      scope.campaignId, scope.since, scope.until, status,
      observation?.snapshotKey ?? null]))
    .digest("hex");

  const metrics: MetricSet | null = observation ? Object.freeze({
    spendMinor: observation.spendMinor,
    impressions: observation.impressions,
    reach: observation.reach,
    clicks: observation.clicks,
    inlineLinkClicks: observation.inlineLinkClicks,
    landingPageViews: observation.landingPageViews,
    metaAttributedPurchases: observation.metaAttributedPurchases,
    pixelPurchaseEvents: observation.pixelPurchaseEvents,
  }) : null;
  return Object.freeze({
    candidateKey,
    stage: "UNATTESTED_READ_CANDIDATE_ONLY" as const,
    provider: "meta_ads" as const,
    product: "demand" as const,
    reportStatus: status,
    windowStart: scope.since,
    windowEndInclusive: scope.until,
    collectedAt: scope.collectedAt,
    metrics,
    independentProviderReceiptRecorded: false as const,
    durableBciEvidenceRecorded: false as const,
    hitpayOrdersReconciled: false as const,
    verifiedPaidOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    executionAllowed: false as const,
  });
}
