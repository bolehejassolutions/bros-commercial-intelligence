import { createHash } from "node:crypto";
import { preregisterDemandExperiment } from "./experiment-preregistration.ts";
import { normalizeMetaCampaignFunnel } from "./meta-insights-funnel.ts";
import type { DemandExperimentProposalInput } from "./experiment-preregistration.ts";
import type { MetaCampaignInsight, MetaFunnelScope } from "./meta-insights-funnel.ts";

/**
 * DEMAND-only descriptive pre/post readout candidate. A sequential comparison
 * cannot prove an experiment ran or establish causality. All source rows and
 * scopes require independent provider/tenant attestation by BCI adapters.
 * This module never reads or writes providers, BCI, Neon or campaigns.
 */
export type DemandSequentialReadout = Readonly<{
  candidateId: string;
  proposalCandidateId: string;
  observationCandidateKeys: readonly [string, string];
  status: "DESCRIPTIVE_READOUT_UNATTESTED";
  design: "SEQUENTIAL_BASELINE_NOT_CONTROLLED";
  comparableCalendarWindows: boolean;
  baselineDays: number;
  followupDays: number;
  /** Deltas are descriptive only; unequal durations or ongoing MYT days => null. */
  spendDeltaMinor: number | null;
  inlineLinkClickDelta: number | null;
  landingPageViewDelta: number | null;
  primaryKpi: DemandExperimentProposalInput["primaryKpi"];
  verifiedPrimaryKpi: null;
  providerAuthenticationVerified: false;
  tenantAuthorizationVerified: false;
  actionApproved: false;
  actionExecuted: false;
  outcomeVerified: false;
  learningVerified: false;
  controlledExperimentVerified: false;
  causalInferenceEligible: false;
  causalLift: null;
  verifiedPaidOrders: null;
  verifiedSettledOrders: null;
  verifiedCacMinor: null;
  executionAllowed: false;
  nextEvidenceRequired: readonly string[];
}>;

const fail = (): never => { throw new Error("Invalid BROS DEMAND sequential readout"); };
function days(start: string, end: string): number {
  return (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) /
    86400000 + 1;
}
function delta(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  const n = b - a;
  return Number.isSafeInteger(n) ? n : null;
}

/** Pure observation projection; NOT an experiment, outcome or learning record. */
export function prepareDemandSequentialReadout(
  preregistration: DemandExperimentProposalInput,
  baselineScope: MetaFunnelScope,
  baselineRow: MetaCampaignInsight,
  followupScope: MetaFunnelScope,
  followupRow: MetaCampaignInsight,
): DemandSequentialReadout {
  // Always reconstruct preregistration from the strict input contract rather
  // than trusting caller-supplied candidateId, approval or attestation flags.
  const proposal = preregisterDemandExperiment(preregistration);
  const baseline = normalizeMetaCampaignFunnel(baselineScope, baselineRow);
  const followup = normalizeMetaCampaignFunnel(followupScope, followupRow);
  if (baseline.tenantId.toLowerCase() !== proposal.tenantId ||
      followup.tenantId.toLowerCase() !== proposal.tenantId ||
      baseline.accountId !== proposal.metaAccountId ||
      followup.accountId !== proposal.metaAccountId ||
      baseline.campaignId !== proposal.campaignId ||
      followup.campaignId !== proposal.campaignId ||
      baseline.windowStart !== proposal.baselineStart ||
      baseline.windowEndInclusive !== proposal.baselineEnd ||
      followup.windowStart !== proposal.experimentStart ||
      followup.windowEndInclusive !== proposal.experimentEnd) fail();

  const baselineDays = days(proposal.baselineStart, proposal.baselineEnd);
  const followupDays = days(proposal.experimentStart, proposal.experimentEnd);
  const comparableCalendarWindows = baselineDays === followupDays &&
    baseline.calendarWindowStatus === "PAST_MYT_DAY" &&
    followup.calendarWindowStatus === "PAST_MYT_DAY";
  const observationCandidateKeys = Object.freeze([
    baseline.snapshotKey, followup.snapshotKey,
  ]) as readonly [string, string];
  const candidateId = "demand:sequential-readout:sha256:" + createHash("sha256")
    .update(JSON.stringify([proposal.candidateId, ...observationCandidateKeys]))
    .digest("hex");
  const nextEvidenceRequired = Object.freeze([
    "independent_provider_and_tenant_attestation",
    "approved_action_and_execution_receipt",
    "controlled_assignment_or_holdout_and_exposure_audit",
    "hitpay_live_product_order_charge_settlement_entitlement_join",
    "qualified_denominator_and_matched_acquisition_cost",
    "durable_bci_decision_action_outcome_learning",
  ]);
  return Object.freeze({
    candidateId, proposalCandidateId: proposal.candidateId,
    observationCandidateKeys,
    status: "DESCRIPTIVE_READOUT_UNATTESTED" as const,
    design: "SEQUENTIAL_BASELINE_NOT_CONTROLLED" as const,
    comparableCalendarWindows, baselineDays, followupDays,
    spendDeltaMinor: comparableCalendarWindows
      ? delta(baseline.spendMinor, followup.spendMinor) : null,
    inlineLinkClickDelta: comparableCalendarWindows
      ? delta(baseline.inlineLinkClicks, followup.inlineLinkClicks) : null,
    landingPageViewDelta: comparableCalendarWindows
      ? delta(baseline.landingPageViews, followup.landingPageViews) : null,
    primaryKpi: proposal.primaryKpi,
    verifiedPrimaryKpi: null,
    providerAuthenticationVerified: false as const,
    tenantAuthorizationVerified: false as const,
    actionApproved: false as const, actionExecuted: false as const,
    outcomeVerified: false as const, learningVerified: false as const,
    controlledExperimentVerified: false as const,
    causalInferenceEligible: false as const, causalLift: null,
    verifiedPaidOrders: null, verifiedSettledOrders: null,
    verifiedCacMinor: null, executionAllowed: false as const,
    nextEvidenceRequired,
  });
}
