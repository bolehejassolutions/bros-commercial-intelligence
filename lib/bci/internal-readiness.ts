/** Shared INTERNAL V1 readiness view. Pure projection; never provider attestation. */
import { evaluateContentEvidence, type ContentEvidence } from "./content-evidence-gate.ts";
import { evaluateDemandExperiment, type DemandEvidence } from "./demand-experiment-gate.ts";

export type InternalReadiness = Readonly<{
  contentEvidenceComplete: boolean;
  demandEvidenceComplete: boolean;
  neonNegativeTestsVerified: boolean;
  sharedBciAuditVerified: boolean;
  hitpayReconciliationVerified: boolean;
  internalV1Ready: boolean;
  pending: readonly string[];
}>;

/** The three externally validated gates default to false, never inferred from CI. */
export function assessInternalReadiness(input: Readonly<{
  tenantId: string;
  contentId: string;
  contentEvidence: readonly ContentEvidence[];
  experimentId: string;
  demandEvidence: readonly DemandEvidence[];
  neonNegativeTestsVerified?: boolean;
  sharedBciAuditVerified?: boolean;
  hitpayReconciliationVerified?: boolean;
}>): InternalReadiness {
  const content = evaluateContentEvidence(input.tenantId,input.contentId,input.contentEvidence);
  const demand = evaluateDemandExperiment(input.tenantId,input.experimentId,input.demandEvidence);
  const flags = {
    contentEvidenceComplete: content.internalV1EvidenceComplete,
    demandEvidenceComplete: demand.internalV1EvidenceComplete,
    neonNegativeTestsVerified: input.neonNegativeTestsVerified === true,
    sharedBciAuditVerified: input.sharedBciAuditVerified === true,
    hitpayReconciliationVerified: input.hitpayReconciliationVerified === true,
  };
  const pending = Object.entries(flags).filter(([,ok])=>!ok).map(([name])=>name);
  return Object.freeze({ ...flags, internalV1Ready: pending.length===0,
    pending: Object.freeze(pending) });
}
