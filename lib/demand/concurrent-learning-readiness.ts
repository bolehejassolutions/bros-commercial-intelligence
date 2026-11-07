import { createHash } from "node:crypto";
import { auditDemandConcurrentExposureCandidates } from "./concurrent-exposure-audit.ts";
import { auditDemandOrderExposureCandidates } from "./concurrent-order-candidate-audit.ts";
import type { DemandConcurrentControlProposal } from "./concurrent-control-protocol.ts";
import type { DemandExposureCandidate } from "./concurrent-exposure-audit.ts";
import type { DemandOrderCandidate } from "./concurrent-order-candidate-audit.ts";

/**
 * DEMAND product-layer evidence-to-next-action review for a proposed concurrent
 * experiment. Structural candidate consistency is NOT randomized assignment,
 * provider authentication, owner approval, settled sales or durable BCI learning.
 * BCI alone owns trusted evidence intake, authorization and persistence.
 */
export type DemandConcurrentLearningReadiness = Readonly<{
  candidateId: string;
  experimentCandidateId: string;
  exposureAuditCandidateId: string;
  orderAuditCandidateId: string;
  status: "EVIDENCE_GAPS_OPEN_UNATTESTED";
  experimentDesign: "CONCURRENT_RANDOMIZED_HOLDOUT_PLAN_UNVERIFIED";
  exposureStructuralConsistency: boolean;
  orderStructuralConsistency: boolean;
  controlAssignmentCandidates: number;
  treatmentAssignmentCandidates: number;
  controlOrderCandidates: number;
  treatmentOrderCandidates: number;
  uniqueOrderIdentityCandidates: number | null;
  findings: readonly string[];
  nextAction: "REVIEW_ASSIGNMENT_EXPOSURE_CONSENT" |
    "REVIEW_ORDER_EXPOSURE_JOIN" |
    "OBTAIN_HITPAY_ORDER_EVIDENCE" |
    "ATTEST_APPROVAL_EXECUTION_PROVIDER_AND_BCI_LEARNING";
  priority: "P1" | "P2";
  requiredIndependentEvidence: readonly string[];
  /** This is a proposed evidence request, not a learning/outcome statement. */
  learningCandidate: "UNVERIFIED_NO_OUTCOME_OR_CAUSAL_CLAIM";
  ownerApprovalVerified: false;
  actionExecutedVerified: false;
  providerAuthenticationVerified: false;
  tenantAuthorizationVerified: false;
  hitpaySettlementVerified: false;
  entitlementVerified: false;
  attributionVerified: false;
  outcomeVerified: false;
  learningVerified: false;
  controlledExperimentVerified: false;
  causalInferenceEligible: false;
  executionAllowed: false;
  verifiedPaidOrders: null;
  verifiedSettledOrders: null;
  verifiedConversionRate: null;
  verifiedCacMinor: null;
  causalLift: null;
}>;

/** Pure and replay-stable: all candidate inputs are revalidated by the audits. */
export function reviewDemandConcurrentLearningReadiness(
  proposal: DemandConcurrentControlProposal,
  exposureEvents: readonly DemandExposureCandidate[],
  orderCandidates: readonly DemandOrderCandidate[],
): DemandConcurrentLearningReadiness {
  const exposure = auditDemandConcurrentExposureCandidates(proposal, exposureEvents);
  const orders = auditDemandOrderExposureCandidates(proposal, exposureEvents, orderCandidates);
  if (exposure.experimentCandidateId !== orders.experimentCandidateId ||
      orders.exposureAuditCandidateId !== exposure.candidateId) {
    throw new Error("Invalid BROS DEMAND concurrent learning readiness");
  }

  const missingOrders = orders.findings.includes("NO_ORDER_CANDIDATES_OBSERVED");
  const materialOrderFindings = orders.findings.filter(code =>
    code !== "NO_ORDER_CANDIDATES_OBSERVED" &&
    code !== "EXPOSURE_AUDIT_NOT_STRUCTURALLY_CONSISTENT");
  let nextAction: DemandConcurrentLearningReadiness["nextAction"];
  if (!exposure.structuralConsistency)
    nextAction = "REVIEW_ASSIGNMENT_EXPOSURE_CONSENT";
  else if (materialOrderFindings.length)
    nextAction = "REVIEW_ORDER_EXPOSURE_JOIN";
  else if (missingOrders)
    nextAction = "OBTAIN_HITPAY_ORDER_EVIDENCE";
  else
    nextAction = "ATTEST_APPROVAL_EXECUTION_PROVIDER_AND_BCI_LEARNING";

  const findings = Object.freeze([...new Set([
    ...exposure.findings.map(code => "EXPOSURE:" + code),
    ...orders.findings.map(code => "ORDER:" + code),
  ])].sort());
  // These are independently required even when candidate structure is clean.
  const requiredIndependentEvidence = Object.freeze([
    "authenticated_pre_registration_before_first_exposure",
    "owner_approved_action_and_execution_receipt",
    "independent_tenant_and_provider_assignment_exposure_attestation",
    "independent_randomization_and_concurrent_control_integrity",
    "consented_eligible_denominators_and_loss_tracking",
    "live_hitpay_paid_settled_product_order_charge_entitlement_join",
    "matched_provider_cost_and_attribution_window",
    "durable_tenant_scoped_bci_outcome_and_learning_readback",
  ]);
  const candidateId = "demand:learning-readiness:sha256:" + createHash("sha256")
    .update(JSON.stringify([proposal.candidateId, exposure.candidateId,
      orders.candidateId, nextAction, findings])).digest("hex");
  return Object.freeze({
    candidateId, experimentCandidateId: proposal.candidateId,
    exposureAuditCandidateId: exposure.candidateId,
    orderAuditCandidateId: orders.candidateId,
    status: "EVIDENCE_GAPS_OPEN_UNATTESTED" as const,
    experimentDesign: "CONCURRENT_RANDOMIZED_HOLDOUT_PLAN_UNVERIFIED" as const,
    exposureStructuralConsistency: exposure.structuralConsistency,
    orderStructuralConsistency: orders.structuralConsistency,
    controlAssignmentCandidates: exposure.controlAssignments,
    treatmentAssignmentCandidates: exposure.treatmentAssignments,
    controlOrderCandidates: orders.controlOrderCandidates,
    treatmentOrderCandidates: orders.treatmentOrderCandidates,
    uniqueOrderIdentityCandidates: orders.uniqueOrderIdentityCandidates,
    findings, nextAction,
    priority: (!exposure.structuralConsistency || materialOrderFindings.length)
      ? "P1" as const : "P2" as const,
    requiredIndependentEvidence,
    learningCandidate: "UNVERIFIED_NO_OUTCOME_OR_CAUSAL_CLAIM" as const,
    ownerApprovalVerified: false as const, actionExecutedVerified: false as const,
    providerAuthenticationVerified: false as const,
    tenantAuthorizationVerified: false as const,
    hitpaySettlementVerified: false as const, entitlementVerified: false as const,
    attributionVerified: false as const, outcomeVerified: false as const,
    learningVerified: false as const, controlledExperimentVerified: false as const,
    causalInferenceEligible: false as const, executionAllowed: false as const,
    verifiedPaidOrders: null, verifiedSettledOrders: null,
    verifiedConversionRate: null, verifiedCacMinor: null, causalLift: null,
  });
}
