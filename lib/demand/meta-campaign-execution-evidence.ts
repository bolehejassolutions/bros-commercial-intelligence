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
    if (!row || typeof row !== "object" || Array.isArray(row)) fail();
    const rowId = row.id;
    if (typeof rowId !== "string" || !campaignIdPattern.test(rowId) ||
        typeof row.status !== "string" || typeof row.effective_status !== "string" ||
        !/^[A-Z_]+$/.test(row.status) || !/^[A-Z_]+$/.test(row.effective_status) ||
        seen.has(rowId as string)) fail();
    const validatedId = rowId as string; // Runtime string validation above.
    seen.add(validatedId);
    if (validatedId === campaignId) target = row;
  }

  // Meta campaign budgets are configuration in minor currency units, NOT
  // measured spend. Missing is unknown, never zero. Budget revisions must
  // change evidence identity even when campaign status stays PAUSED.
  const budgetMinorUnits = (value: unknown): number | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) fail();
    return parsed;
  };
  const configuredDailyBudgetMinorUnits = target === null
    ? null : budgetMinorUnits(target.daily_budget);
  const configuredLifetimeBudgetMinorUnits = target === null
    ? null : budgetMinorUnits(target.lifetime_budget);
  const budgetConfigurationObserved =
    configuredDailyBudgetMinorUnits !== null ||
    configuredLifetimeBudgetMinorUnits !== null;

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
    .update(JSON.stringify(["v2", accountId, campaignId, state,
      target?.status ?? null, target?.effective_status ?? null,
      configuredDailyBudgetMinorUnits, configuredLifetimeBudgetMinorUnits]))
    .digest("hex");

  return Object.freeze({
    snapshotKey, state, nextBestEvidenceAction,
    configuredDailyBudgetMinorUnits, configuredLifetimeBudgetMinorUnits,
    budgetConfigurationObserved,
    budgetConfigurationIsSpendEvidence: false as const,
    measuredSpendMinorUnits: null,
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


/**
 * DEMAND_META_ACTIVITY_CANDIDATE_GUARD_20261028_2304_V1
 * A real HYPD Meta account activity feed can report a campaign's NAME and
 * status-change event, but omit campaign ID, previous/new status and action
 * authorization. Never turn a name match into proof of a specific campaign
 * activation, experiment execution, spend, outcome or causal lift.
 *
 * This is a privacy-minimized candidate projection only; BCI owns trusted
 * authenticated object-level receipts and durable tenant-scoped lineage.
 */
export type DemandMetaActivityInventory = Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  nextPageToken: string | null;
  missingScopes: readonly string[] | null;
  droppedFields?: readonly string[] | null;
}>;

export function assessDemandCampaignActivityCandidates(
  accountId: string,
  campaignId: string,
  exactCampaignName: string,
  since: string,
  until: string,
  response: DemandMetaActivityInventory,
) {
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day + "T00:00:00Z")) &&
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day;
  if (typeof accountId !== "string" || !accountIdPattern.test(accountId) ||
      typeof campaignId !== "string" || !campaignIdPattern.test(campaignId) ||
      typeof exactCampaignName !== "string" ||
      exactCampaignName.length < 8 || exactCampaignName.length > 250 ||
      typeof since !== "string" || typeof until !== "string" ||
      !validDay(since) || !validDay(until) || since > until ||
      !response || !Array.isArray(response.rows) ||
      response.rows.length > 500 || response.nextPageToken !== null ||
      (response.missingScopes !== null &&
        (!Array.isArray(response.missingScopes) || response.missingScopes.length > 0)) ||
      (response.droppedFields != null &&
        (!Array.isArray(response.droppedFields) || response.droppedFields.length > 0))) fail();

  const matching: string[] = [];
  const matchedTypes: string[] = [];
  for (const row of response.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        typeof row.event_type !== "string" ||
        !/^[a-z_]{3,80}$/.test(row.event_type) ||
        typeof row.object_name !== "string" ||
        row.object_name.length > 250 ||
        typeof row.event_time !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0000$/.test(row.event_time) ||
        !Number.isFinite(Date.parse(row.event_time)) ||
        new Date(Date.parse(row.event_time)).toISOString().slice(0, 19) !==
          row.event_time.slice(0, 19)) fail();
    if (row.object_name === exactCampaignName) {
      matching.push(JSON.stringify([row.event_type, row.event_time]));
      matchedTypes.push(row.event_type as string); // Runtime validated above.
    }
  }
  const statusChangeCandidates = matchedTypes.filter(
    eventType => eventType === "update_campaign_run_status").length;
  const state = matching.length === 0 ? "NO_MATCHING_ACTIVITY_ROWS_NOT_ZERO" :
    statusChangeCandidates > 0 ? "NAME_MATCHED_STATUS_ACTIVITY_UNATTESTED" :
      "NAME_MATCHED_OTHER_ACTIVITY_UNATTESTED";
  const snapshotKey = "demand:campaign-activity:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1", accountId, campaignId, exactCampaignName,
      since, until, matching.sort()])).digest("hex");
  return Object.freeze({
    snapshotKey, state,
    matchingNameActivityRows: matching.length,
    statusChangeCandidates,
    nextBestEvidenceAction: "OBTAIN_OBJECT_ID_BOUND_BEFORE_AFTER_ACTION_RECEIPT" as const,
    identityBinding: "CAMPAIGN_NAME_ONLY_UNATTESTED" as const,
    providerAuthenticationVerified: false as const,
    appTenantAuthorizationVerified: false as const,
    ownerApprovalVerified: false as const,
    experimentActionVerified: false as const,
    verifiedSpendMinor: null,
    verifiedPaidOrders: null,
    verifiedSettledOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    causalLift: null,
    verifiedOutcome: null,
    durableBciLearningVerified: false as const,
  });
}
