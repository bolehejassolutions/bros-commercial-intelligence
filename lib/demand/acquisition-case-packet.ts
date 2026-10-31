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
  // DEMAND_CASE_FUTURE_ATTESTATION_GUARD_20261028: a *case* is a
  // present-tense decision handoff, unlike the pure Meta projection which
  // must support offline replay of hypothetical future experiment windows.
  // Caller-asserted evidence collection and preregistration timestamps must
  // not be materially ahead of the executing clock. Five minutes allows
  // bounded skew; BCI still owns independent provider/time attestation.
  const latestPermittedTime = Date.now() + 5 * 60 * 1000;
  if (Date.parse(scope.collectedAt) > latestPermittedTime ||
      Date.parse(proposal.preRegisteredAt) > latestPermittedTime) {
    throw new Error("Invalid BROS DEMAND acquisition case chronology");
  }
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

  // Freshness is an advisory based on the proposed decision's own MYT date,
  // not the time this pure function happens to be replayed. A stale baseline
  // can support historical diagnosis but must not be treated as current
  // acquisition evidence for executing a new experiment.
  const preregMytDay = new Date(Date.parse(proposal.preRegisteredAt) + 8 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const baselineAgeDaysAtPreregistration =
    (Date.parse(preregMytDay + "T00:00:00Z") -
      Date.parse(proposal.baselineEnd + "T00:00:00Z")) / 86400000;
  const baselineRefreshRecommended = baselineAgeDaysAtPreregistration > 7;
  const nextBestEvidenceAction = baselineRefreshRecommended
    ? "REFRESH_AUTHENTICATED_ACQUISITION_BASELINE"
    : diagnosis.nextAction;

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
    // DEMAND_COST_TO_CASH_OBSERVATION_20261028: present campaign cost and
    // merchant payment as TWO independent observations. These are not a
    // transaction-level join, a matched time cohort, or verified sales ROI.
    // The shared BCI worker owns trusted provider receipts and persistence.
    independentProviderObservations: Object.freeze({
      meta: Object.freeze({
        currency: "MYR" as const,
        spendMinor: diagnosis.metaObservedSpendMinor,
        inlineLinkClicks: diagnosis.metaObservedInlineLinkClicks,
        landingPageViews: diagnosis.metaObservedLandingPageViews,
        attributedPurchaseEvents: diagnosis.metaAttributedPurchaseEvents,
        pixelPurchaseEvents: diagnosis.pixelPurchaseEvents,
      }),
      hitpay: Object.freeze({
        currency: "MYR" as const,
        paymentStatus: diagnosis.hitpayPaymentObservation,
        grossMinor: diagnosis.hitpayGrossMinor,
        feeMinor: diagnosis.hitpayFeeMinor,
        netAfterFeesMinor: diagnosis.hitpayNetMinor,
        refundedMinor: diagnosis.hitpayRefundedMinor,
      }),
      crossProviderAttribution: "UNVERIFIED_UNJOINED" as const,
      paymentSettlement: "UNVERIFIED" as const,
      brosSellProductIdentity: "UNVERIFIED" as const,
    }),
    proposedAction: proposal.action,
    hypothesis: proposal.hypothesis,
    primaryKpi: proposal.primaryKpi,
    // Seven days is a DEMAND advisory threshold, NOT a provider freshness
    // attestation or an owner-approved experiment policy. Historical cases
    // remain inspectable; a new action still requires independent evidence.
    baselineAgeDaysAtPreregistration,
    baselineFreshnessAdvisory: baselineRefreshRecommended
      ? "REFRESH_RECOMMENDED" as const : "RECENT_COMPLETED_WINDOW" as const,
    nextBestEvidenceAction,
    requiredIndependentEvidence: Object.freeze([
      ...diagnosis.requiredIndependentEvidence,
      ...(baselineRefreshRecommended ? ["fresh_authenticated_baseline_before_action"] : []),
    ]),
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
