import { createHash } from "node:crypto";
import { normalizeUntrustedEvidence } from "./untrusted-evidence.ts";

/**
 * BCI-owned, OFFLINE/READ-ONLY preflight for DEMAND's internal Meta read candidate.
 * This function does NOT authenticate its caller, read Meta, query Neon, or write
 * evidence. It MUST NOT be mounted as a public API or fed a user-selected tenant.
 * The future BCI authenticated worker supplies the scope from its independently
 * verified principal + product membership, then obtains/attests a provider read.
 *
 * A matching candidate hash is only a consistency check, NEVER a credential,
 * independently verified provider receipt, settled order, or persistence proof.
 */
type IntakeScope = Readonly<{
  tenantId: string;
  product: "demand";
  accountId: string;
  campaignId: string;
  since: string;
  until: string;
}>;
type Candidate = Readonly<{
  candidateKey: string;
  stage: "UNATTESTED_READ_CANDIDATE_ONLY";
  reportStatus: "NO_ROWS_NOT_ZERO" | "CAMPAIGN_ROW_OBSERVED_UNATTESTED";
  windowStart: string;
  windowEndInclusive: string;
  collectedAt: string;
  metricsPresent: boolean;
  independentProviderReceiptRecorded: false;
  durableBciEvidenceRecorded: false;
  executionAllowed: false;
}>;
type Report = Readonly<{
  campaignId: string;
  windowStart: string;
  windowEndInclusive: string;
  snapshotKey: string;
  currency: "MYR";
  spendMinor: number | null;
  inlineLinkClicks: number | null;
  landingPageViews: number | null;
  metaAttributedPurchases: number | null;
  pixelPurchaseEvents: number | null;
  actionAliasMismatch: boolean;
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const day = /^\d{4}-\d{2}-\d{2}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const snapshot = /^meta_ads:sha256:[0-9a-f]{64}$/;
const keyPattern = /^demand:meta-read:sha256:[0-9a-f]{64}$/;
const fail = (): never => { throw new Error("BCI DEMAND Meta intake preflight denied."); };
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: unknown, names: readonly string[]) =>
  object(v) && Reflect.ownKeys(v).length === names.length &&
  Reflect.ownKeys(v).every(k => typeof k === "string" && names.includes(k) &&
    Object.getOwnPropertyDescriptor(v,k)?.enumerable === true);
const validDay = (v: unknown): v is string =>
  typeof v === "string" && day.test(v) &&
  Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
  new Date(Date.parse(v + "T00:00:00Z")).toISOString().slice(0,10) === v;
const nonnegativeCount = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
const metricsKeys = ["spendMinor","inlineLinkClicks","landingPageViews",
  "metaAttributedPurchases","pixelPurchaseEvents"] as const;

/** Server-injected scope, never constructed from request headers/query strings. */
export function planUnattestedDemandMetaEvidenceIntake(
  scope: IntakeScope,
  candidate: Candidate,
  report: Report | null,
) {
  if (!exact(scope, ["tenantId","product","accountId","campaignId","since","until"]) ||
      typeof scope.tenantId !== "string" || !uuid.test(scope.tenantId) ||
      scope.product !== "demand" ||
      typeof scope.accountId !== "string" || !/^act_[0-9]+$/.test(scope.accountId) ||
      typeof scope.campaignId !== "string" || !/^[0-9]+$/.test(scope.campaignId) ||
      !validDay(scope.since) || !validDay(scope.until) || scope.since > scope.until ||
      !exact(candidate, ["candidateKey","stage","reportStatus","windowStart",
        "windowEndInclusive","collectedAt","metricsPresent",
        "independentProviderReceiptRecorded","durableBciEvidenceRecorded","executionAllowed"]) ||
      candidate.stage !== "UNATTESTED_READ_CANDIDATE_ONLY" ||
      (candidate.reportStatus !== "NO_ROWS_NOT_ZERO" &&
        candidate.reportStatus !== "CAMPAIGN_ROW_OBSERVED_UNATTESTED") ||
      candidate.windowStart !== scope.since || candidate.windowEndInclusive !== scope.until ||
      !keyPattern.test(candidate.candidateKey) ||
      typeof candidate.collectedAt !== "string" || !timestamp.test(candidate.collectedAt) ||
      !Number.isFinite(Date.parse(candidate.collectedAt)) ||
      new Date(Date.parse(candidate.collectedAt)).toISOString().replace(".000Z","Z") !== candidate.collectedAt ||
      candidate.independentProviderReceiptRecorded !== false ||
      candidate.durableBciEvidenceRecorded !== false ||
      candidate.executionAllowed !== false) fail();

  const empty = candidate.reportStatus === "NO_ROWS_NOT_ZERO";
  if (candidate.metricsPresent !== !empty || (empty && report !== null) ||
      (!empty && !object(report))) fail();

  if (!empty) {
    if (!exact(report, ["campaignId","windowStart","windowEndInclusive","snapshotKey",
      "currency","spendMinor","inlineLinkClicks","landingPageViews",
      "metaAttributedPurchases","pixelPurchaseEvents","actionAliasMismatch"]) ||
      report!.campaignId !== scope.campaignId ||
      report!.windowStart !== scope.since ||
      report!.windowEndInclusive !== scope.until ||
      report!.currency !== "MYR" || !snapshot.test(report!.snapshotKey) ||
      typeof report!.actionAliasMismatch !== "boolean" ||
      metricsKeys.some(k => !nonnegativeCount(report![k]))) fail();
  }

  // Byte-compatible with DEMAND's candidate builder. This recomputation is
  // a tampering detector only: anyone can forge a hash without independently
  // authenticated provider evidence. The trusted BCI worker still owns receipt.
  const expectedKey = "demand:meta-read:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1",scope.tenantId.toLowerCase(),scope.accountId,
      scope.campaignId,scope.since,scope.until,candidate.reportStatus,
      empty ? null : report!.snapshotKey])).digest("hex");
  if (expectedKey !== candidate.candidateKey) fail();

  const metrics = Object.freeze({
    spend_minor: empty ? null : report!.spendMinor,
    inline_link_clicks: empty ? null : report!.inlineLinkClicks,
    landing_page_views: empty ? null : report!.landingPageViews,
    meta_attributed_purchases: empty ? null : report!.metaAttributedPurchases,
    pixel_purchase_events: empty ? null : report!.pixelPurchaseEvents,
  });
  // Check the shared envelope and the real Neon DEV evidence schema contract,
  // but NEVER set provider_verified or mark the current row as persisted.
  const envelope = normalizeUntrustedEvidence({
    tenantId: scope.tenantId.toLowerCase(), product: "demand",
    provider: "meta_ads", providerRecordKey: candidate.candidateKey,
    observedAt: candidate.collectedAt, environment: "unknown",
    provenance: "provider_reported", metrics,
  });

  const unknowns = [
    "independent_provider_receipt_not_verified",
    "bci_durable_receipt_not_recorded",
    "hitpay_paid_order_not_reconciled",
    "campaign_impact_not_causal",
    ...(empty ? ["no_rows_spend_and_conversion_metrics_unknown"] : []),
  ];
  const plannedRow = Object.freeze({
    tenant_id: envelope.tenantId, product: envelope.product,
    provider: envelope.provider, provider_record_key: envelope.providerRecordKey,
    source_reference: "demand:unattested:direct-meta-read-only",
    observed_at: envelope.observedAt,
    period_start: scope.since + "T00:00:00+08:00",
    period_end: scope.until + "T23:59:59+08:00",
    collected_at: candidate.collectedAt,
    completeness: "unverified" as const,
    metrics, facts: Object.freeze([
      Object.freeze({ kind: "unattested_meta_read_status", value: candidate.reportStatus }),
      Object.freeze({ kind: "metadata_consistency_only", value: "candidate_hash_matched" }),
    ]),
    unknowns: Object.freeze(unknowns),
  });
  // Returned as an OFFLINE proposal only. A BCI-authorized, provider-attested
  // append boundary must independently validate it before any SQL INSERT.
  return Object.freeze({
    intakeStage: "UNTRUSTED_BCI_PREFLIGHT_ONLY" as const,
    candidateKey: candidate.candidateKey,
    status: candidate.reportStatus,
    proposedRow: plannedRow,
    authenticatedProviderReceiptRecorded: false as const,
    durableBciEvidenceRecorded: false as const,
    permissionToWrite: false as const,
    verifiedPaidOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
  });
}
