import { createHash } from "node:crypto";

/**
 * DEMAND-only read-only campaign-status acceptance preflight.
 * HYPD's caller-supplied inventory is not an authenticated app receipt.
 * A PAUSED status is a point-in-time configuration, not proof of zero spend,
 * no historic purchases, an experiment action, or a verified outcome.
 */
export type DemandCampaignInventory = Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  nextPageToken: string | null;
  missingScopes: readonly string[] | null;
  droppedFields?: readonly string[] | null;
}>;

const fail = (): never => { throw new Error("Invalid DEMAND campaign status inventory"); };
const accountIdPattern = /^act_[0-9]+$/;
const campaignIdPattern = /^[0-9]+$/;

export function assessDemandCampaignExecutionEvidence(
  accountId: string,
  campaignId: string,
  response: DemandCampaignInventory,
) {
  if (typeof accountId !== "string" || !accountIdPattern.test(accountId) ||
      typeof campaignId !== "string" || !campaignIdPattern.test(campaignId) ||
      !response || !Array.isArray(response.rows) ||
      response.rows.length > 500 || response.nextPageToken !== null ||
      (response.missingScopes !== null &&
        (!Array.isArray(response.missingScopes) || response.missingScopes.length > 0)) ||
      (response.droppedFields != null &&
        (!Array.isArray(response.droppedFields) || response.droppedFields.length > 0))) fail();

  const seen = new Set<string>();
  let target: Readonly<Record<string, unknown>> | null = null;
  for (const row of response.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        typeof row.id !== "string" || !campaignIdPattern.test(row.id) ||
        typeof row.status !== "string" || typeof row.effective_status !== "string" ||
        !/^[A-Z_]+$/.test(row.status) || !/^[A-Z_]+$/.test(row.effective_status) ||
        seen.has(row.id)) fail();
    seen.add(row.id);
    if (row.id === campaignId) target = row;
  }

  // Both configured and effective PAUSED are required for this narrow finding.
  // ACTIVE is not proof of delivery; no insights/HitPay join is supplied here.
  const state = target === null ? "TARGET_NOT_IN_INVENTORY" :
    target.status === "PAUSED" && target.effective_status === "PAUSED"
      ? "PAUSED_AT_READBACK" :
    target.status === "ACTIVE" && target.effective_status === "ACTIVE"
      ? "ACTIVE_CONFIGURATION_UNVERIFIED_DELIVERY" : "STATUS_REQUIRES_REVIEW";
  const nextBestEvidenceAction = state === "PAUSED_AT_READBACK"
    ? "NO_LIVE_EXPERIMENT_ACTION_OBSERVED_VERIFY_SEPARATELY" :
    state === "TARGET_NOT_IN_INVENTORY" ? "VERIFY_EXACT_CAMPAIGN_INVENTORY" :
    "OBTAIN_AUTHENTICATED_CAMPAIGN_ACTION_AND_INSIGHTS_RECEIPTS";
  const snapshotKey = "demand:campaign-status:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1", accountId, campaignId, state,
      target?.status ?? null, target?.effective_status ?? null]))
    .digest("hex");

  return Object.freeze({
    snapshotKey, state, nextBestEvidenceAction,
    // Status from an external connector is an observation, not a trusted receipt.
    statusProviderAuthenticationVerified: false as const,
    appTenantAuthorizationVerified: false as const,
    experimentActionVerified: false as const,
    verifiedProviderOutcome: null,
    verifiedSettledOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    causalLift: null,
    durableBciLearningVerified: false as const,
  });
}
