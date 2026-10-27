import { createHash } from "node:crypto";
import { proposeDemandConcurrentControl } from "./concurrent-control-protocol.ts";
import { auditDemandConcurrentExposureCandidates } from "./concurrent-exposure-audit.ts";
import type { DemandConcurrentControlProposal } from "./concurrent-control-protocol.ts";
import type { DemandExposureCandidate } from "./concurrent-exposure-audit.ts";

/** DEMAND-only untrusted order-candidate/exposure join. No provider, payment,
 * identity, settlement, entitlement, approval, attribution or BCI attestation.
 * Never pass raw visitor/order/payment IDs.
 */
export type DemandOrderCandidate = Readonly<{
  eventId: string; experimentCandidateId: string; tenantId: string;
  product: "demand"; pilotProduct: "bros_sell";
  visitorDigest: string; orderCandidateKey: string;
  /** Optional stable 64-hex digest of one order across revised HitPay snapshots.
   * Never supply raw order IDs. Caller identity is untrusted. */
  orderIdentityDigest?: string;
  arm: "control" | "treatment"; observedAt: string;
}>;
export type DemandOrderCandidateAudit = Readonly<{
  candidateId: string; experimentCandidateId: string; exposureAuditCandidateId: string;
  status: "UNATTESTED_ORDER_EXPOSURE_JOIN";
  controlOrderCandidates: number; treatmentOrderCandidates: number;
  orderIdentityCoverageComplete: boolean;
  uniqueOrderIdentityCandidates: number | null; // never verified paid orders
  findings: readonly string[]; structuralConsistency: boolean;
  providerAuthenticationVerified: false; tenantMembershipVerified: false;
  randomizedAssignmentVerified: false; consentIndependentlyVerified: false;
  ownerApprovalVerified: false; actionExecutedVerified: false;
  hitpayLiveEnvironmentVerified: false; hitpaySettlementVerified: false;
  entitlementVerified: false; attributionVerified: false;
  outcomeVerified: false; learningVerified: false;
  causalInferenceEligible: false; executionAllowed: false;
  verifiedPaidOrders: null; settledOrders: null; verifiedConversionRate: null;
  verifiedCacMinor: null; causalLift: null;
}>;
const EVENT_ID = /^[A-Za-z0-9_:.\/-]{8,250}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ORDER_KEY = /^demand:hitpay-candidate:sha256:[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const fail = (): never => { throw new Error("Invalid BROS DEMAND order exposure candidates"); };

export function auditDemandOrderExposureCandidates(
  proposal: DemandConcurrentControlProposal,
  exposureEvents: readonly DemandExposureCandidate[],
  orderCandidates: readonly DemandOrderCandidate[],
): DemandOrderCandidateAudit {
  const replay = (() => { try { return proposeDemandConcurrentControl(proposal); }
    catch { return fail(); } })();
  if (replay.candidateId !== proposal.candidateId ||
      !Array.isArray(exposureEvents) || !Array.isArray(orderCandidates) ||
      orderCandidates.length > 10000) fail();
  const exposureAudit = (() => { try {
    return auditDemandConcurrentExposureCandidates(proposal, exposureEvents);
  } catch { return fail(); } })();

  const exposures = new Map<string, { arm: "control" | "treatment"; time: number; consent: boolean }>();
  // Exposure audit has already validated these events. Use the same canonical
  // earliest-event selection so provider page order cannot change an order join.
  const orderedExposureEvents = [...exposureEvents].sort((a, b) =>
    Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
    (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  for (const event of orderedExposureEvents) {
    if (event.kind === "exposure" && !exposures.has(event.visitorDigest)) {
      exposures.set(event.visitorDigest, {
        arm: event.arm, time: Date.parse(event.observedAt), consent: event.consentRecorded,
      });
    }
  }
  const seenEventIds = new Set<string>(), seenOrderKeys = new Set<string>();
  const seenOrderIdentities = new Map<string, { key: string; visitor: string; arm: string }>();
  let identityCoverageComplete = orderCandidates.length > 0;
  const findings = new Set<string>(), normalized: string[] = [];
  let control = 0, treatment = 0;
  const start = Date.parse(proposal.plannedStart + "T00:00:00+08:00");
  const endExclusive = Date.parse(proposal.plannedEnd + "T00:00:00+08:00") + 86400000;
  for (const candidate of orderCandidates) {
    if (!candidate || !EVENT_ID.test(candidate.eventId) ||
        candidate.experimentCandidateId !== proposal.candidateId ||
        candidate.tenantId !== proposal.tenantId || candidate.product !== "demand" ||
        candidate.pilotProduct !== "bros_sell" ||
        !DIGEST.test(candidate.visitorDigest) || !ORDER_KEY.test(candidate.orderCandidateKey) ||
        (candidate.orderIdentityDigest !== undefined &&
          !DIGEST.test(candidate.orderIdentityDigest)) ||
        (candidate.arm !== "control" && candidate.arm !== "treatment") ||
        !UTC.test(candidate.observedAt) ||
        !Number.isFinite(Date.parse(candidate.observedAt)) ||
        new Date(Date.parse(candidate.observedAt)).toISOString().slice(0, 19) !==
          candidate.observedAt.slice(0, 19) || seenEventIds.has(candidate.eventId)) fail();
    seenEventIds.add(candidate.eventId);
    if (seenOrderKeys.has(candidate.orderCandidateKey)) findings.add("DUPLICATE_ORDER_CANDIDATE");
    seenOrderKeys.add(candidate.orderCandidateKey);
    if (candidate.orderIdentityDigest === undefined) identityCoverageComplete = false;
    else {
      const previous = seenOrderIdentities.get(candidate.orderIdentityDigest);
      if (previous) {
        if (previous.key !== candidate.orderCandidateKey)
          findings.add("SAME_ORDER_REVISED_SNAPSHOT_REVIEW_REQUIRED");
        if (previous.arm !== candidate.arm)
          findings.add("SAME_ORDER_CROSS_ARM");
        if (previous.visitor !== candidate.visitorDigest)
          findings.add("SAME_ORDER_MULTIPLE_VISITORS");
      } else seenOrderIdentities.set(candidate.orderIdentityDigest, {
        key: candidate.orderCandidateKey, visitor: candidate.visitorDigest,
        arm: candidate.arm,
      });
    }
    const exposure = exposures.get(candidate.visitorDigest);
    const time = Date.parse(candidate.observedAt);
    if (!exposure) findings.add("ORDER_CANDIDATE_WITHOUT_EXPOSURE");
    else {
      if (candidate.arm !== exposure.arm) findings.add("ORDER_CANDIDATE_CROSS_ARM");
      if (time < exposure.time) findings.add("ORDER_CANDIDATE_BEFORE_EXPOSURE");
      if (!exposure.consent) findings.add("EXPOSURE_CONSENT_NOT_RECORDED");
    }
    // An unapproved post-window attribution policy cannot be assumed.
    if (time < start || time >= endExclusive)
      findings.add("ORDER_CANDIDATE_OUTSIDE_EXPERIMENT_WINDOW_REVIEW_REQUIRED");
    if (candidate.arm === "control") control++; else treatment++;
    normalized.push(JSON.stringify([candidate.eventId, candidate.experimentCandidateId,
      candidate.tenantId, candidate.product, candidate.pilotProduct,
      candidate.visitorDigest, candidate.orderCandidateKey,
      candidate.orderIdentityDigest ?? null, candidate.arm,
      candidate.observedAt]));
  }
  if (!exposureAudit.structuralConsistency)
    findings.add("EXPOSURE_AUDIT_NOT_STRUCTURALLY_CONSISTENT");
  if (!orderCandidates.length) findings.add("NO_ORDER_CANDIDATES_OBSERVED");
  const sortedFindings = Object.freeze([...findings].sort());
  const candidateId = "demand:order-exposure-audit:sha256:" + createHash("sha256")
    .update(JSON.stringify([proposal.candidateId, exposureAudit.candidateId, normalized.sort()]))
    .digest("hex");
  return Object.freeze({
    candidateId, experimentCandidateId: proposal.candidateId,
    exposureAuditCandidateId: exposureAudit.candidateId,
    status: "UNATTESTED_ORDER_EXPOSURE_JOIN" as const,
    controlOrderCandidates: control, treatmentOrderCandidates: treatment,
    orderIdentityCoverageComplete: identityCoverageComplete,
    uniqueOrderIdentityCandidates: identityCoverageComplete ? seenOrderIdentities.size : null,
    findings: sortedFindings, structuralConsistency: sortedFindings.length === 0,
    providerAuthenticationVerified: false as const, tenantMembershipVerified: false as const,
    randomizedAssignmentVerified: false as const, consentIndependentlyVerified: false as const,
    ownerApprovalVerified: false as const, actionExecutedVerified: false as const,
    hitpayLiveEnvironmentVerified: false as const, hitpaySettlementVerified: false as const,
    entitlementVerified: false as const, attributionVerified: false as const,
    outcomeVerified: false as const, learningVerified: false as const,
    causalInferenceEligible: false as const, executionAllowed: false as const,
    verifiedPaidOrders: null, settledOrders: null, verifiedConversionRate: null,
    verifiedCacMinor: null, causalLift: null,
  });
}
