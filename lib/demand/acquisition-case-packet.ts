import { createHash } from "node:crypto";
import { reviewDemandAcquisitionEvidencePair } from "./historical-acquisition-evidence.ts";
import { preregisterDemandExperiment } from "./experiment-preregistration.ts";
import type { MetaCampaignInsight, MetaFunnelScope } from "./meta-insights-funnel.ts";
import type {
  HitPayOrderObservation, HitPayChargeObservation, HitPayChargeDetailObservation,
} from "./hitpay-order-charge.ts";
import type { DemandExperimentProposalInput } from "./experiment-preregistration.ts";

/**
 * DEMAND-only diagnosis -> proposed decision/action handoff. This is a
 * non-executable, untrusted product-layer candidate for the shared BCI core.
 * The actual BCI worker owns authenticated evidence intake, tenant membership,
 * persistence, approval, outcome and learning. Never promote a candidate ID
 * or a coincident Meta/HitPay observation to provider attestation.
 */
export function prepareDemandAcquisitionCasePacket(
  scope: MetaFunnelScope,
  metaRow: MetaCampaignInsight,
  order: HitPayOrderObservation,
  charge: HitPayChargeObservation,
  chargeDetail: HitPayChargeDetailObservation,
  experiment: DemandExperimentProposalInput,
) {
  // Both components independently revalidate the raw inputs. Never accept
  // caller-supplied "verified", "approved" or "settled" result objects.
  const diagnosis = reviewDemandAcquisitionEvidencePair(
    scope, metaRow, order, charge, chargeDetail,
  );
  const proposal = preregisterDemandExperiment(experiment);
  // A preregistered diagnosis cannot cite a provider snapshot collected later
  // than its declared registration time, or an unfinished MYT baseline day.
  // This checks internal chronology only: both timestamps remain untrusted
  // until the BCI worker independently authenticates and persists receipts.
  const collectedMytDay = new Date(Date.parse(scope.collectedAt) + 8 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  if (Date.parse(scope.collectedAt) > Date.parse(proposal.preRegisteredAt) ||
      scope.until >= collectedMytDay) {
    throw new Error("Invalid BROS DEMAND acquisition case chronology");
  }
  if (proposal.tenantId !== scope.tenantId.toLowerCase() ||
      proposal.metaAccountId !== scope.accountId ||
      proposal.campaignId !== scope.campaignId ||
      proposal.baselineStart !== scope.since ||
      proposal.baselineEnd !== scope.until ||
      !proposal.evidenceCandidateIds.includes(diagnosis.pairKey)) {
    throw new Error("Invalid BROS DEMAND acquisition case linkage");
  }

  const caseId = "demand:acquisition-case:sha256:" + createHash("sha256")
    .update(JSON.stringify([
      "v1", proposal.candidateId, diagnosis.pairKey, diagnosis.nextAction,
    ])).digest("hex");

  return Object.freeze({
    caseId,
    stage: "DIAGNOSIS_AND_ACTION_PROPOSAL_ONLY" as const,
    status: "UNATTESTED_NOT_AUTHORIZED" as const,
    product: "demand" as const,
    pilotProduct: "bros_sell" as const,
    // Opaque evidence references, not provider receipts or raw payer IDs.
    sourceEvidenceCandidateIds: Object.freeze([
      diagnosis.metaSnapshotKey, diagnosis.hitpayCandidateKey,
      diagnosis.pairKey,
    ]),
    experimentProposalCandidateId: proposal.candidateId,
    diagnosisCode: diagnosis.nextAction,
    metaPurchaseAliasConflict: diagnosis.metaPurchaseAliasConflict,
    proposedAction: proposal.action,
    hypothesis: proposal.hypothesis,
    primaryKpi: proposal.primaryKpi,
    nextBestEvidenceAction: diagnosis.nextAction,
    requiredIndependentEvidence: diagnosis.requiredIndependentEvidence,
    // Owner approval must be tied to a trusted, immutable action in BCI.
    ownerApprovalRequired: true as const,
    ownerApprovalVerified: false as const,
    providerAuthenticationVerified: false as const,
    tenantAuthorizationVerified: false as const,
    metaEventToOrderJoinVerified: false as const,
    hitpaySettlementVerified: false as const,
    entitlementVerified: false as const,
    actionExecutedVerified: false as const,
    outcomeVerified: false as const,
    learningVerified: false as const,
    controlledExperimentVerified: false as const,
    causalInferenceEligible: false as const,
    executionAllowed: false as const,
    maxIncrementalSpendMinor: 0 as const,
    noPricingChanges: true as const,
    noPublisherChanges: true as const,
    verifiedPaidOrders: null,
    verifiedSettledOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    verifiedPrimaryKpi: null,
    causalLift: null,
    verifiedOutcome: null,
    recordedLearning: null,
  });
}
