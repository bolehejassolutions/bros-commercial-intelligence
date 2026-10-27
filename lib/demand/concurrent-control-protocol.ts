import { createHash } from "node:crypto";

/**
 * DEMAND-only, non-executable protocol for a proposed concurrent holdout.
 * A protocol is NOT randomized assignment, authenticated approval, a provider
 * observation, a verified conversion, or causal evidence. BCI owns shared
 * identity/tenant authorization, durable audit and trusted evidence intake.
 */
export type DemandConcurrentControlInput = Readonly<{
  tenantId: string;
  product: "demand";
  pilotProduct: "bros_sell";
  metaAccountId: string;
  campaignId: string;
  hypothesis: string;
  action: "LANDING_PAGE_TEST";
  treatmentChange: string;
  primaryKpi: "verified_paid_orders" | "qualified_visit_to_paid_order_rate";
  plannedStart: string; // MYT day, both arms concurrently
  plannedEnd: string; // MYT day, both arms concurrently
  preRegisteredAt: string; // caller-supplied UTC, NOT attested
  evidenceCandidateIds: readonly string[];
  assignmentUnit: "CONSENTED_LANDING_VISITOR";
  assignmentMethod: "STICKY_RANDOM_50_50_PROPOSED";
  controlExperience: "UNCHANGED_EXISTING_LANDING_PAGE";
  analysisPolicy: "INTENTION_TO_TREAT";
  maxIncrementalSpendMinor: 0;
}>;

export type DemandConcurrentControlProposal = Readonly<{
  candidateId: string;
  tenantId: string;
  product: "demand";
  pilotProduct: "bros_sell";
  metaAccountId: string;
  campaignId: string;
  hypothesis: string;
  action: "LANDING_PAGE_TEST";
  treatmentChange: string;
  primaryKpi: DemandConcurrentControlInput["primaryKpi"];
  plannedStart: string;
  plannedEnd: string;
  preRegisteredAt: string;
  evidenceCandidateIds: readonly string[];
  assignmentUnit: DemandConcurrentControlInput["assignmentUnit"];
  assignmentMethod: DemandConcurrentControlInput["assignmentMethod"];
  controlExperience: DemandConcurrentControlInput["controlExperience"];
  analysisPolicy: DemandConcurrentControlInput["analysisPolicy"];
  allocation: Readonly<{ controlPercent: 50; treatmentPercent: 50 }>;
  /** Required *future* evidence, not claimed to exist. */
  acceptanceEvidence: readonly string[];
  experimentDesign: "CONCURRENT_RANDOMIZED_HOLDOUT_PLAN_UNVERIFIED";
  status: "PROPOSED_NOT_AUTHORIZED";
  tenantAuthorizationVerified: false;
  preRegistrationAttested: false;
  assignmentAndExposureVerified: false;
  concurrentControlVerified: false;
  providerEvidenceAttested: false;
  actionApproved: false;
  actionExecuted: false;
  outcomeVerified: false;
  learningVerified: false;
  controlledExperimentVerified: false;
  causalInferenceEligible: false;
  executionAllowed: false;
  verifiedPaidOrders: null;
  verifiedCacMinor: null;
  causalLift: null;
  maxIncrementalSpendMinor: 0;
  requiresOwnerApproval: true;
  noPricingChanges: true;
  noPublisherChanges: true;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const EVIDENCE_ID = /^[A-Za-z0-9_:.\/-]{8,250}$/;
const fail = (): never => { throw new Error("Invalid BROS DEMAND concurrent control protocol"); };
function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const n = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === v;
}
function validUtc(v: unknown): v is string {
  if (typeof v !== "string" || !UTC.test(v)) return false;
  const n = Date.parse(v);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 19) === v.slice(0, 19);
}

/** Propose a concurrent design; never promote caller claims into verification. */
export function proposeDemandConcurrentControl(
  input: DemandConcurrentControlInput,
): DemandConcurrentControlProposal {
  if (!input || !UUID.test(input.tenantId) || input.product !== "demand" ||
      input.pilotProduct !== "bros_sell" || !/^act_\d+$/.test(input.metaAccountId) ||
      !/^\d+$/.test(input.campaignId) ||
      typeof input.hypothesis !== "string" || input.hypothesis.trim().length < 20 ||
      input.hypothesis.length > 500 || input.action !== "LANDING_PAGE_TEST" ||
      typeof input.treatmentChange !== "string" ||
      input.treatmentChange.trim().length < 20 || input.treatmentChange.length > 300 ||
      !["verified_paid_orders", "qualified_visit_to_paid_order_rate"].includes(input.primaryKpi) ||
      !validDate(input.plannedStart) || !validDate(input.plannedEnd) ||
      !validUtc(input.preRegisteredAt) || input.plannedStart > input.plannedEnd ||
      // Local MYT midnight: date-only UTC comparisons can accept a late plan.
      Date.parse(input.preRegisteredAt) >= Date.parse(input.plannedStart + "T00:00:00+08:00") ||
      input.assignmentUnit !== "CONSENTED_LANDING_VISITOR" ||
      input.assignmentMethod !== "STICKY_RANDOM_50_50_PROPOSED" ||
      input.controlExperience !== "UNCHANGED_EXISTING_LANDING_PAGE" ||
      input.analysisPolicy !== "INTENTION_TO_TREAT" ||
      input.maxIncrementalSpendMinor !== 0 ||
      !Array.isArray(input.evidenceCandidateIds) || input.evidenceCandidateIds.length < 1 ||
      input.evidenceCandidateIds.length > 20 ||
      input.evidenceCandidateIds.some(id => typeof id !== "string" || !EVIDENCE_ID.test(id)) ||
      new Set(input.evidenceCandidateIds).size !== input.evidenceCandidateIds.length) fail();

  const evidenceCandidateIds = Object.freeze([...input.evidenceCandidateIds].sort());
  const protocol = [input.tenantId.toLowerCase(), "demand", "bros_sell", input.metaAccountId,
    input.campaignId, input.hypothesis.trim(), input.action, input.treatmentChange.trim(),
    input.primaryKpi, input.plannedStart, input.plannedEnd, input.preRegisteredAt,
    input.assignmentUnit, input.assignmentMethod, input.controlExperience,
    input.analysisPolicy, evidenceCandidateIds, 0];
  const candidateId = "demand:concurrent-control:sha256:" + createHash("sha256")
    .update(JSON.stringify(protocol)).digest("hex");
  const acceptanceEvidence = Object.freeze([
    "independently_attested_pre_registration_before_first_exposure",
    "owner_approved_control_and_treatment_action",
    "authenticated_sticky_assignment_and_exposure_log_for_both_arms",
    "concurrent_control_and_treatment_no_contamination",
    "consented_eligible_visitor_denominators_and_loss_tracking",
    "independently_verified_hitpay_live_paid_settled_order_and_entitlement_join",
    "provider_confirmed_costs_and_attribution_window",
    "durable_tenant_scoped_bci_outcome_and_learning_readback",
  ]);
  return Object.freeze({
    candidateId, tenantId: input.tenantId.toLowerCase(), product: "demand" as const,
    pilotProduct: "bros_sell" as const, metaAccountId: input.metaAccountId,
    campaignId: input.campaignId, hypothesis: input.hypothesis.trim(),
    action: "LANDING_PAGE_TEST" as const, treatmentChange: input.treatmentChange.trim(),
    primaryKpi: input.primaryKpi, plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd, preRegisteredAt: input.preRegisteredAt,
    evidenceCandidateIds, assignmentUnit: input.assignmentUnit,
    assignmentMethod: input.assignmentMethod, controlExperience: input.controlExperience,
    analysisPolicy: input.analysisPolicy,
    allocation: Object.freeze({ controlPercent: 50 as const, treatmentPercent: 50 as const }),
    acceptanceEvidence,
    experimentDesign: "CONCURRENT_RANDOMIZED_HOLDOUT_PLAN_UNVERIFIED" as const,
    status: "PROPOSED_NOT_AUTHORIZED" as const,
    tenantAuthorizationVerified: false as const, preRegistrationAttested: false as const,
    assignmentAndExposureVerified: false as const, concurrentControlVerified: false as const,
    providerEvidenceAttested: false as const, actionApproved: false as const,
    actionExecuted: false as const, outcomeVerified: false as const,
    learningVerified: false as const, controlledExperimentVerified: false as const,
    causalInferenceEligible: false as const, executionAllowed: false as const,
    verifiedPaidOrders: null, verifiedCacMinor: null, causalLift: null,
    maxIncrementalSpendMinor: 0 as const, requiresOwnerApproval: true as const,
    noPricingChanges: true as const, noPublisherChanges: true as const,
  });
}
