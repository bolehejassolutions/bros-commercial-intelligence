import { createHash } from "node:crypto";

/**
 * DEMAND-only experiment preregistration. Pure planning, no provider access.
 * Evidence references are caller-supplied candidates, NOT attestation.
 * BCI owns authenticated persistence, tenant scope and shared audit.
 */
export type DemandExperimentProposalInput = Readonly<{
  tenantId: string;
  product: "demand";
  pilotProduct: "bros_sell";
  metaAccountId: string;
  campaignId: string;
  hypothesis: string;
  action: "CREATIVE_TEST" | "LANDING_PAGE_TEST" | "AUDIENCE_TEST";
  primaryKpi: "verified_paid_orders" | "verified_cac_minor" | "qualified_visit_to_paid_order_rate";
  baselineStart: string;
  baselineEnd: string;
  experimentStart: string;
  experimentEnd: string;
  preRegisteredAt: string;
  evidenceCandidateIds: readonly string[];
  maxIncrementalSpendMinor: 0;
}>;

export type DemandExperimentProposal = Readonly<{
  candidateId: string;
  status: "PROPOSED_NOT_AUTHORIZED";
  tenantId: string;
  product: "demand";
  pilotProduct: "bros_sell";
  campaignId: string;
  primaryKpi: DemandExperimentProposalInput["primaryKpi"];
  evidenceCandidateIds: readonly string[];
  providerEvidenceAttested: false;
  tenantAuthorizationVerified: false;
  actionApproved: false;
  actionExecuted: false;
  outcomeVerified: false;
  learningVerified: false;
  executionAllowed: false;
  verifiedPaidOrders: null;
  verifiedCacMinor: null;
  causalLift: null;
  requiresOwnerApproval: true;
  maxIncrementalSpendMinor: 0;
  noPricingChanges: true;
  noPublisherChanges: true;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const EVIDENCE_ID = /^[A-Za-z0-9_:.\/-]{8,250}$/;
const fail = (): never => { throw new Error("Invalid BROS DEMAND experiment preregistration"); };
function validDate(v: unknown): v is string {
  return typeof v === "string" && DATE.test(v) &&
    Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
    new Date(Date.parse(v + "T00:00:00Z")).toISOString().slice(0, 10) === v;
}
function validUtc(v: unknown): v is string {
  return typeof v === "string" && UTC.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(Date.parse(v)).toISOString().slice(0, 19) === v.slice(0, 19);
}

/** Generates an immutable, non-executable proposal. Never treats IDs as verified evidence. */
export function preregisterDemandExperiment(
  input: DemandExperimentProposalInput,
): DemandExperimentProposal {
  if (!input || !UUID.test(input.tenantId) || input.product !== "demand" ||
      input.pilotProduct !== "bros_sell" || !/^act_\d+$/.test(input.metaAccountId) ||
      !/^\d+$/.test(input.campaignId) ||
      typeof input.hypothesis !== "string" ||
      input.hypothesis.trim().length < 20 || input.hypothesis.length > 500 ||
      !["CREATIVE_TEST", "LANDING_PAGE_TEST", "AUDIENCE_TEST"].includes(input.action) ||
      !["verified_paid_orders", "verified_cac_minor", "qualified_visit_to_paid_order_rate"]
        .includes(input.primaryKpi) ||
      !validDate(input.baselineStart) || !validDate(input.baselineEnd) ||
      !validDate(input.experimentStart) || !validDate(input.experimentEnd) ||
      !validUtc(input.preRegisteredAt) ||
      input.baselineStart > input.baselineEnd ||
      input.baselineEnd >= input.experimentStart ||
      input.experimentStart > input.experimentEnd ||
      input.preRegisteredAt.slice(0, 10) > input.experimentStart ||
      input.maxIncrementalSpendMinor !== 0 ||
      !Array.isArray(input.evidenceCandidateIds) ||
      input.evidenceCandidateIds.length < 1 || input.evidenceCandidateIds.length > 20 ||
      input.evidenceCandidateIds.some(id => typeof id !== "string" || !EVIDENCE_ID.test(id)) ||
      new Set(input.evidenceCandidateIds).size !== input.evidenceCandidateIds.length) fail();

  const evidenceCandidateIds = Object.freeze([...input.evidenceCandidateIds].sort());
  const candidateId = "demand:experiment:sha256:" + createHash("sha256").update(JSON.stringify([
    input.tenantId.toLowerCase(), input.product, input.pilotProduct,
    input.metaAccountId, input.campaignId, input.hypothesis.trim(),
    input.action, input.primaryKpi, input.baselineStart, input.baselineEnd,
    input.experimentStart, input.experimentEnd, input.preRegisteredAt,
    evidenceCandidateIds, input.maxIncrementalSpendMinor,
  ])).digest("hex");
  return Object.freeze({
    candidateId, status: "PROPOSED_NOT_AUTHORIZED" as const,
    tenantId: input.tenantId.toLowerCase(), product: "demand" as const,
    pilotProduct: "bros_sell" as const, campaignId: input.campaignId,
    primaryKpi: input.primaryKpi, evidenceCandidateIds,
    providerEvidenceAttested: false as const,
    tenantAuthorizationVerified: false as const,
    actionApproved: false as const, actionExecuted: false as const,
    outcomeVerified: false as const, learningVerified: false as const,
    executionAllowed: false as const,
    verifiedPaidOrders: null, verifiedCacMinor: null, causalLift: null,
    requiresOwnerApproval: true as const, maxIncrementalSpendMinor: 0 as const,
    noPricingChanges: true as const, noPublisherChanges: true as const,
  });
}
