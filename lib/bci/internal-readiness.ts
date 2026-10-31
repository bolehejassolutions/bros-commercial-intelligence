/** Shared INTERNAL V1 readiness view. Pure projection; never provider attestation. */
import { evaluateContentEvidence, type ContentEvidence } from "./content-evidence-gate.ts";
import { evaluateDemandExperiment, type DemandEvidence } from "./demand-experiment-gate.ts";

export type InternalReadiness = Readonly<{
  contentEvidenceComplete: boolean;
  demandEvidenceComplete: boolean;
  neonNegativeTestsVerified: boolean;
  sharedBciAuditVerified: boolean;
  hitpayReconciliationVerified: boolean;
  /** Untrusted input completeness only; never release authorization. */
  unattestedCandidateComplete: boolean;
  /** Cannot be true until a separate authenticated, persisted attestation path exists. */
  internalV1Ready: false;
  pending: readonly string[];
}>;

/** Caller booleans are untrusted projections, not authenticated provider attestations. */
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
  const missing = Object.entries(flags).filter(([,ok])=>!ok).map(([name])=>name);
  // Fail closed: this pure function cannot attest JWT, provider, DB persistence or audit.
  // A future trusted server-owned acceptance path must replace this sentinel.
  const pending = [...missing, "authenticatedEndToEndAttestation"];
  return Object.freeze({ ...flags, unattestedCandidateComplete: missing.length===0,
    internalV1Ready: false as const, pending: Object.freeze(pending) });
}
