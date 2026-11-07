import { createHash } from "node:crypto";
import { proposeDemandConcurrentControl } from "./concurrent-control-protocol.ts";
import type { DemandConcurrentControlProposal } from "./concurrent-control-protocol.ts";

/**
 * DEMAND-only structural review of untrusted assignment/exposure candidates.
 * NOT an assignment service, provider attestation, randomized-control proof,
 * authorization, outcome verification or BCI audit. Never pass raw visitor IDs.
 */
export type DemandExposureCandidate = Readonly<{
  eventId: string;
  experimentCandidateId: string;
  tenantId: string;
  product: "demand";
  visitorDigest: string; // pseudonymous 64-character SHA-256 digest
  kind: "assignment" | "exposure";
  arm: "control" | "treatment";
  observedAt: string; // caller-supplied UTC, NOT attested
  consentRecorded: boolean;
}>;
export type DemandExposureAudit = Readonly<{
  candidateId: string;
  experimentCandidateId: string;
  status: "UNATTESTED_STRUCTURAL_REVIEW";
  controlAssignments: number;
  treatmentAssignments: number;
  controlExposures: number;
  treatmentExposures: number;
  assignedWithoutExposure: number;
  findings: readonly string[];
  structuralConsistency: boolean;
  assignmentRandomnessVerified: false;
  providerEvidenceAttested: false;
  consentIndependentlyVerified: false;
  ownerApprovalVerified: false;
  experimentExecutedVerified: false;
  outcomeVerified: false;
  learningVerified: false;
  causalInferenceEligible: false;
  executionAllowed: false;
  verifiedPaidOrders: null;
  verifiedCacMinor: null;
  causalLift: null;
}>;
const DIGEST = /^[a-f0-9]{64}$/;
const EVENT_ID = /^[A-Za-z0-9_:.\/-]{8,250}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const fail = (): never => { throw new Error("Invalid BROS DEMAND concurrent exposure candidates"); };

export function auditDemandConcurrentExposureCandidates(
  proposal: DemandConcurrentControlProposal,
  events: readonly DemandExposureCandidate[],
): DemandExposureAudit {
  if (!proposal || proposal.product !== "demand" ||
      proposal.status !== "PROPOSED_NOT_AUTHORIZED" ||
      proposal.experimentDesign !== "CONCURRENT_RANDOMIZED_HOLDOUT_PLAN_UNVERIFIED" ||
      !/^demand:concurrent-control:sha256:[a-f0-9]{64}$/.test(proposal.candidateId) ||
      !Array.isArray(events) || events.length > 10000) fail();
  // A syntactically plausible candidate ID is NOT a preregistered protocol.
  // Recompute the immutable plan from its complete fields: a forged scope,
  // treatment, KPI, window or candidate ID cannot be laundered into a clean
  // exposure review. This replay is still NOT authenticated preregistration.
  const replay = (() => {
    try { return proposeDemandConcurrentControl(proposal); }
    catch { return fail(); }
  })();
  // The candidate hash binds the input plan, but not derived safety fields.
  // Reject modified/extra protocol claims, including approval, zero-spend
  // guardrails and acceptance requirements. Order of object keys is irrelevant.
  const canonical = replay as unknown as Record<string, unknown>;
  const supplied = proposal as unknown as Record<string, unknown>;
  const canonicalKeys = Object.keys(canonical);
  if (Object.keys(supplied).length !== canonicalKeys.length ||
      Object.keys(supplied).some(key => !Object.prototype.hasOwnProperty.call(canonical, key)) ||
      canonicalKeys.some(key => {
        const expected = canonical[key], actual = supplied[key];
        if (Array.isArray(expected))
          return !Array.isArray(actual) || actual.length !== expected.length ||
            expected.some((value, index) => actual[index] !== value);
        if (key === "allocation")
          return !actual || typeof actual !== "object" || Array.isArray(actual) ||
            Object.keys(actual).length !== 2 ||
            (actual as {controlPercent?: unknown}).controlPercent !== 50 ||
            (actual as {treatmentPercent?: unknown}).treatmentPercent !== 50;
        return actual !== expected;
      })) fail();
  if (replay.candidateId !== proposal.candidateId ||
      proposal.allocation?.controlPercent !== 50 ||
      proposal.allocation?.treatmentPercent !== 50 ||
      proposal.actionApproved !== false || proposal.actionExecuted !== false ||
      proposal.tenantAuthorizationVerified !== false ||
      proposal.preRegistrationAttested !== false ||
      proposal.assignmentAndExposureVerified !== false ||
      proposal.providerEvidenceAttested !== false ||
      proposal.outcomeVerified !== false || proposal.learningVerified !== false ||
      proposal.executionAllowed !== false || proposal.causalInferenceEligible !== false ||
      proposal.verifiedPaidOrders !== null || proposal.verifiedCacMinor !== null ||
      proposal.causalLift !== null) fail();
  const start = Date.parse(proposal.plannedStart + "T00:00:00+08:00");
  const endExclusive = Date.parse(proposal.plannedEnd + "T00:00:00+08:00") + 86400000;
  if (!Number.isFinite(start) || !Number.isFinite(endExclusive) || start >= endExclusive) fail();

  const ids = new Set<string>();
  const assignments = new Map<string, "control" | "treatment">();
  const exposures = new Map<string, "control" | "treatment">();
  const assignmentTimes = new Map<string, number>();
  const exposureTimes = new Map<string, number>();
  const findings = new Set<string>();
  const normalized: string[] = [];
  const validatedEvents: DemandExposureCandidate[] = [];
  // Validate the complete batch before selecting the canonical first event
  // for each visitor. Otherwise the same candidateId could yield different
  // findings/counts merely because provider pages arrived in a new order.
  for (const event of events) {
    if (!event || typeof event.eventId !== "string" || !EVENT_ID.test(event.eventId) ||
        event.experimentCandidateId !== proposal.candidateId ||
        event.tenantId !== proposal.tenantId || event.product !== "demand" ||
        typeof event.visitorDigest !== "string" || !DIGEST.test(event.visitorDigest) ||
        !["assignment", "exposure"].includes(event.kind) ||
        !["control", "treatment"].includes(event.arm) ||
        typeof event.observedAt !== "string" || !UTC.test(event.observedAt) ||
        !Number.isFinite(Date.parse(event.observedAt)) ||
        new Date(Date.parse(event.observedAt)).toISOString().slice(0, 19) !== event.observedAt.slice(0, 19) ||
        typeof event.consentRecorded !== "boolean" || ids.has(event.eventId)) fail();
    ids.add(event.eventId);
    validatedEvents.push(event);
    normalized.push(JSON.stringify([event.eventId, event.experimentCandidateId,
      event.tenantId, event.product, event.visitorDigest, event.kind,
      event.arm, event.observedAt, event.consentRecorded]));
  }
  validatedEvents.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
    (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  for (const event of validatedEvents) {
    const t = Date.parse(event.observedAt);
    if (t < start || t >= endExclusive) findings.add("EVENT_OUTSIDE_PREREGISTERED_WINDOW");
    if (!event.consentRecorded) findings.add("CONSENT_NOT_RECORDED");
    const group = event.kind === "assignment" ? assignments : exposures;
    if (group.has(event.visitorDigest)) {
      findings.add("DUPLICATE_VISITOR_" + event.kind.toUpperCase());
      // A later opposite-arm event is evidence of a broken sticky assignment
      // or exposure contract, even if the canonical first event matches the
      // other kind. Never silently reduce contradictory events to a count.
      if (group.get(event.visitorDigest) !== event.arm)
        findings.add("CONFLICTING_VISITOR_" + event.kind.toUpperCase() + "_ARMS");
    } else {
      group.set(event.visitorDigest, event.arm);
      (event.kind === "assignment" ? assignmentTimes : exposureTimes)
        .set(event.visitorDigest, t);
    }
  }
  for (const [visitor, arm] of exposures) {
    if (!assignments.has(visitor)) findings.add("EXPOSURE_WITHOUT_ASSIGNMENT");
    else if (assignments.get(visitor) !== arm) findings.add("CROSS_ARM_CONTAMINATION");
    if (assignmentTimes.has(visitor) && exposureTimes.get(visitor)! < assignmentTimes.get(visitor)!)
      findings.add("EXPOSURE_BEFORE_ASSIGNMENT");
  }
  const assignedWithoutExposure = [...assignments.keys()].filter(v => !exposures.has(v)).length;
  if (!assignments.size) findings.add("NO_ASSIGNMENTS_OBSERVED");
  if (![...assignments.values()].includes("control") ||
      ![...assignments.values()].includes("treatment")) findings.add("BOTH_ARMS_NOT_OBSERVED");
  if (assignedWithoutExposure) findings.add("ASSIGNED_WITHOUT_EXPOSURE");
  // No raw visitor IDs, retrieval timestamps or provider credentials in candidate identity.
  const candidateId = "demand:exposure-audit:sha256:" + createHash("sha256")
    .update(JSON.stringify([proposal.candidateId, normalized.sort()])).digest("hex");
  const count = (m: Map<string, "control" | "treatment">, arm: "control" | "treatment") =>
    [...m.values()].filter(a => a === arm).length;
  const sortedFindings = Object.freeze([...findings].sort());
  return Object.freeze({ candidateId, experimentCandidateId: proposal.candidateId,
    status: "UNATTESTED_STRUCTURAL_REVIEW" as const,
    controlAssignments: count(assignments, "control"),
    treatmentAssignments: count(assignments, "treatment"),
    controlExposures: count(exposures, "control"),
    treatmentExposures: count(exposures, "treatment"),
    assignedWithoutExposure, findings: sortedFindings,
    structuralConsistency: sortedFindings.length === 0,
    assignmentRandomnessVerified: false as const,
    providerEvidenceAttested: false as const,
    consentIndependentlyVerified: false as const,
    ownerApprovalVerified: false as const,
    experimentExecutedVerified: false as const,
    outcomeVerified: false as const, learningVerified: false as const,
    causalInferenceEligible: false as const, executionAllowed: false as const,
    verifiedPaidOrders: null, verifiedCacMinor: null, causalLift: null,
  });
}
