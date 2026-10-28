import { createHash } from "node:crypto";
import type { DemandCampaignInventory } from "./meta-campaign-execution-evidence.ts";

/**
 * DEMAND-only structural readback of a complete Meta account inventory.
 * This is an external connector observation, NOT an app-authenticated receipt,
 * ad-delivery proof, approval to launch, or verified acquisition outcome.
 * Other campaigns' adsets/ads cannot be counted as assets of the target.
 */
type ObjectKind = "campaign" | "adset" | "ad";
type MetaObject = Readonly<{
  id: string;
  campaignId: string | null;
  adsetId: string | null;
  status: string;
  effectiveStatus: string;
  creativeId: string | null;
}>;
const ID = /^[0-9]+$/;
const ACCOUNT = /^act_[0-9]+$/;
const STATUS = /^[A-Z_]+$/;
const fail = (): never => { throw new Error("Invalid DEMAND Meta structural inventory"); };

function validateInventory(response: DemandCampaignInventory, kind: ObjectKind): MetaObject[] {
  if (!response || !Array.isArray(response.rows) || response.rows.length > 500 ||
      response.nextPageToken !== null ||
      (response.missingScopes !== null &&
        (!Array.isArray(response.missingScopes) || response.missingScopes.length !== 0)) ||
      (response.droppedFields != null &&
        (!Array.isArray(response.droppedFields) || response.droppedFields.length !== 0))) fail();
  const seen = new Set<string>();
  const objects: MetaObject[] = [];
  for (const row of response.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail();
    const id = row.id;
    const status = row.status;
    const effectiveStatus = row.effective_status;
    if (typeof id !== "string" || !ID.test(id) || seen.has(id) ||
        typeof status !== "string" || !STATUS.test(status) ||
        typeof effectiveStatus !== "string" || !STATUS.test(effectiveStatus)) fail();
    seen.add(id as string);
    const parent = kind === "campaign" ? null : row.campaign_id;
    const adset = kind === "ad" ? row.adset_id : null;
    // A missing parent identifier is UNKNOWN, never proof of zero target assets.
    // Provider inventories must be complete and relationally joinable.
    if ((kind !== "campaign" && (typeof parent !== "string" || !ID.test(parent))) ||
        (kind === "ad" && (typeof adset !== "string" || !ID.test(adset)))) fail();
    let creativeId: string | null = null;
    if (kind === "ad" && row.creative !== undefined && row.creative !== null) {
      if (typeof row.creative !== "object" || Array.isArray(row.creative)) fail();
      const value = (row.creative as Record<string, unknown>).id;
      if (typeof value !== "string" || !ID.test(value)) fail();
      creativeId = value as string;
    }
    objects.push({ id: id as string, campaignId: parent as string | null,
      adsetId: adset as string | null, status: status as string,
      effectiveStatus: effectiveStatus as string, creativeId });
  }
  return objects;
}

export function assessDemandMetaCampaignStructure(
  accountId: string,
  campaignId: string,
  campaigns: DemandCampaignInventory,
  adsets: DemandCampaignInventory,
  ads: DemandCampaignInventory,
) {
  if (typeof accountId !== "string" || !ACCOUNT.test(accountId) ||
      typeof campaignId !== "string" || !ID.test(campaignId)) fail();
  const campaignRows = validateInventory(campaigns, "campaign");
  const adsetRows = validateInventory(adsets, "adset");
  const adRows = validateInventory(ads, "ad");
  // A full-account readback cannot silently discard unjoinable adsets/ads.
  // This is structural integrity only; no delivery or outcome attestation.
  const campaignIds = new Set(campaignRows.map(row => row.id));
  const adsetParents = new Map(adsetRows.map(row => [row.id, row.campaignId]));
  if (adsetRows.some(row => !campaignIds.has(row.campaignId ?? "")) ||
      adRows.some(row => !campaignIds.has(row.campaignId ?? "") ||
        // Target orphans remain an explicit diagnostic state; an ad attached
        // to a different campaign's adset must never pass as target-ready.
        (row.campaignId !== campaignId &&
          adsetParents.get(row.adsetId ?? "") !== row.campaignId) ||
        (row.campaignId === campaignId &&
          adsetParents.has(row.adsetId ?? "") &&
          adsetParents.get(row.adsetId ?? "") !== row.campaignId))) fail();
  const target = campaignRows.find(row => row.id === campaignId) ?? null;
  const targetAdsets = adsetRows.filter(row => row.campaignId === campaignId);
  const targetAds = adRows.filter(row => row.campaignId === campaignId);
  const targetAdsetIds = new Set(targetAdsets.map(row => row.id));
  const orphanAds = targetAds.filter(row => !targetAdsetIds.has(row.adsetId ?? ""));
  const missingCreativeReferences = targetAds.filter(row => row.creativeId === null).length;
  const state = target === null ? "TARGET_CAMPAIGN_NOT_IN_INVENTORY" :
    orphanAds.length > 0 ? "TARGET_ADS_WITHOUT_MATCHING_ADSET" :
    targetAdsets.length === 0 ? "NO_ADSETS_OR_ADS_AT_READBACK" :
    targetAds.length === 0 ? "ADSETS_PRESENT_NO_ADS_AT_READBACK" :
    missingCreativeReferences > 0 ? "ADS_MISSING_CREATIVE_REFERENCES" :
    "ASSETS_PRESENT_DELIVERY_UNVERIFIED";
  const nextBestEvidenceAction =
    state === "NO_ADSETS_OR_ADS_AT_READBACK" ||
    state === "ADSETS_PRESENT_NO_ADS_AT_READBACK"
      ? "VERIFY_APPROVED_ADSET_AND_AD_ASSETS_BEFORE_LAUNCH" :
    state === "ASSETS_PRESENT_DELIVERY_UNVERIFIED"
      ? "OBTAIN_AUTHENTICATED_DELIVERY_AND_EXPERIMENT_ACTION_RECEIPTS" :
      "REVIEW_INCOMPLETE_OR_INCONSISTENT_CAMPAIGN_STRUCTURE";
  const canonical = (rows: MetaObject[]) => rows.map(row =>
    [row.id, row.campaignId, row.adsetId, row.status,
      row.effectiveStatus, row.creativeId]).sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const snapshotKey = "demand:meta-structure:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1", accountId, campaignId,
      target ? canonical([target]) : null,
      canonical(targetAdsets), canonical(targetAds)])).digest("hex");
  return Object.freeze({
    snapshotKey, state, nextBestEvidenceAction,
    campaignStatus: target?.status ?? null,
    campaignEffectiveStatus: target?.effectiveStatus ?? null,
    adsetCount: targetAdsets.length,
    adCount: targetAds.length,
    creativeReferenceCount: targetAds.length - missingCreativeReferences,
    orphanAdCount: orphanAds.length,
    completeAccountInventoriesObserved: true as const,
    structuralAssetsObserved: state === "ASSETS_PRESENT_DELIVERY_UNVERIFIED",
    connectorReadbackIsAppAuthenticated: false as const,
    tenantAuthorizationVerified: false as const,
    campaignLaunchAuthorizedByThisAssessment: false as const,
    deliveryVerified: false as const,
    experimentActionVerified: false as const,
    verifiedProviderOutcome: null,
    verifiedPaidOrders: null,
    verifiedSettledOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    causalLift: null,
    durableBciLearningVerified: false as const,
  });
}
