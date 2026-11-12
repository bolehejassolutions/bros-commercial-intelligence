import { createHash } from "node:crypto";

type BrosSellCreativeBrief = Readonly<{
  locale: "ms-MY";
  baselineV5AdId: string;
  baselineEvidenceId: string;
  narrative: Readonly<{
    KENA: string;
    PELIK: string;
    TERFIKIR: string;
    FAHAM: string;
    "NAMPAK NILAI": string;
  }>;
  editorial: Readonly<{
    threeSecondRecognition: string;
    kedaiKopiReadAloud: string;
    buyerValue: string;
    productTruth: Readonly<{
      capability: "SALES_OPPORTUNITY" | "BUYER_DIAGNOSIS" | "OBJECTION_AND_VALUE" | "FOLLOW_UP";
      evidenceId: string;
    }>;
    ethicsAndCompliance: string;
  }>;
}>;

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
  creativeBrief?: BrosSellCreativeBrief;
}>;

export type DemandExperimentProposal = Readonly<{
  candidateId: string;
  status: "PROPOSED_NOT_AUTHORIZED";
  tenantId: string;
  product: "demand";
  pilotProduct: "bros_sell";
  metaAccountId: string;
  campaignId: string;
  /** Immutable proposal details for reviewer replay; caller-supplied, NOT attested. */
  hypothesis: string;
  action: DemandExperimentProposalInput["action"];
  primaryKpi: DemandExperimentProposalInput["primaryKpi"];
  baselineStart: string;
  baselineEnd: string;
  experimentStart: string;
  experimentEnd: string;
  preRegisteredAt: string;
  evidenceCandidateIds: readonly string[];
  creativeBrief?: BrosSellCreativeBrief;
  /** Historical baseline and later test window alone are NOT a controlled trial. */
  experimentDesign: "SEQUENTIAL_BASELINE_NOT_CONTROLLED";
  controlledExperimentVerified: false;
  causalInferenceEligible: false;
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
const CREATIVE_DOCTRINE_EFFECTIVE_DAY = "2026-11-10";
const NARRATIVE_STAGES = ["KENA", "PELIK", "TERFIKIR", "FAHAM", "NAMPAK NILAI"] as const;
const SELL_CAPABILITIES = ["SALES_OPPORTUNITY", "BUYER_DIAGNOSIS", "OBJECTION_AND_VALUE", "FOLLOW_UP"];
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

function exactFields(value: unknown, fields: readonly string[]): boolean {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === fields.length && fields.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    });
}

function reviewText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 400 && value.trim().length >= 8 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function prepareBrosSellCreativeBrief(
  value: BrosSellCreativeBrief, evidenceCandidateIds: readonly string[],
): BrosSellCreativeBrief {
  if (!exactFields(value, ["locale", "baselineV5AdId", "baselineEvidenceId", "narrative", "editorial"]) ||
      value.locale !== "ms-MY" || typeof value.baselineV5AdId !== "string" ||
      !/^[0-9]{5,30}$/.test(value.baselineV5AdId) ||
      !evidenceCandidateIds.includes(value.baselineEvidenceId) ||
      !exactFields(value.narrative, NARRATIVE_STAGES) ||
      !NARRATIVE_STAGES.every(stage => reviewText(value.narrative[stage])) ||
      !exactFields(value.editorial, ["threeSecondRecognition", "kedaiKopiReadAloud", "buyerValue",
        "productTruth", "ethicsAndCompliance"])) fail();
  const editorial = value.editorial;
  const truth = editorial.productTruth;
  if (![editorial.threeSecondRecognition, editorial.kedaiKopiReadAloud, editorial.buyerValue,
      editorial.ethicsAndCompliance].every(reviewText) ||
      !exactFields(truth, ["capability", "evidenceId"]) || !SELL_CAPABILITIES.includes(truth.capability) ||
      !evidenceCandidateIds.includes(truth.evidenceId)) fail();

  // Preserve concrete review notes and source references for human review.
  // Shape checks do not attest Malay fluency, verified claims or approval.
  return Object.freeze({
    locale: "ms-MY",
    baselineV5AdId: value.baselineV5AdId,
    baselineEvidenceId: value.baselineEvidenceId,
    narrative: Object.freeze({
      KENA: value.narrative.KENA.trim(),
      PELIK: value.narrative.PELIK.trim(),
      TERFIKIR: value.narrative.TERFIKIR.trim(),
      FAHAM: value.narrative.FAHAM.trim(),
      "NAMPAK NILAI": value.narrative["NAMPAK NILAI"].trim(),
    }),
    editorial: Object.freeze({
      threeSecondRecognition: editorial.threeSecondRecognition.trim(),
      kedaiKopiReadAloud: editorial.kedaiKopiReadAloud.trim(),
      buyerValue: editorial.buyerValue.trim(),
      productTruth: Object.freeze({ capability: truth.capability, evidenceId: truth.evidenceId }),
      ethicsAndCompliance: editorial.ethicsAndCompliance.trim(),
    }),
  });
}

/** Generates an immutable, non-executable proposal. Never treats IDs as verified evidence. */
export function preregisterDemandExperiment(
  input: DemandExperimentProposalInput,
): DemandExperimentProposal {
  // RegExp.test coerces arrays/objects into strings; never let an untrusted
  // tenant, account or campaign identity cross this proposal boundary.
  if (!input || typeof input.tenantId !== "string" ||
      !UUID.test(input.tenantId) || input.product !== "demand" ||
      input.pilotProduct !== "bros_sell" ||
      typeof input.metaAccountId !== "string" ||
      !/^act_\d+$/.test(input.metaAccountId) ||
      typeof input.campaignId !== "string" || !/^\d+$/.test(input.campaignId) ||
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
      // MYT experiment day begins at 00:00 UTC+08; UTC date-only comparison
      // would accept a proposal registered after local experiment start.
      // Caller-supplied timestamps are NOT independent registration attestation.
      Date.parse(input.preRegisteredAt) >= Date.parse(input.experimentStart + "T00:00:00+08:00") ||
      input.maxIncrementalSpendMinor !== 0 ||
      !Array.isArray(input.evidenceCandidateIds) ||
      input.evidenceCandidateIds.length < 1 || input.evidenceCandidateIds.length > 20 ||
      input.evidenceCandidateIds.some(id => typeof id !== "string" || !EVIDENCE_ID.test(id)) ||
      new Set(input.evidenceCandidateIds).size !== input.evidenceCandidateIds.length) fail();

  const evidenceCandidateIds = Object.freeze([...input.evidenceCandidateIds].sort());
  const creativeBriefInput = Object.getOwnPropertyDescriptor(input, "creativeBrief");
  if (creativeBriefInput && !Object.hasOwn(creativeBriefInput, "value")) fail();
  const requiresCreativeBrief = input.action === "CREATIVE_TEST" &&
    (input.experimentStart >= CREATIVE_DOCTRINE_EFFECTIVE_DAY ||
     Date.parse(input.preRegisteredAt) >= Date.parse(CREATIVE_DOCTRINE_EFFECTIVE_DAY + "T00:00:00+08:00"));
  if ((requiresCreativeBrief && !creativeBriefInput?.value) ||
      (input.action !== "CREATIVE_TEST" && creativeBriefInput)) fail();
  const creativeBrief = creativeBriefInput
    ? prepareBrosSellCreativeBrief(creativeBriefInput.value, evidenceCandidateIds) : undefined;
  const candidateId = "demand:experiment:sha256:" + createHash("sha256").update(JSON.stringify([
    input.tenantId.toLowerCase(), input.product, input.pilotProduct,
    input.metaAccountId, input.campaignId, input.hypothesis.trim(),
    input.action, input.primaryKpi, input.baselineStart, input.baselineEnd,
    input.experimentStart, input.experimentEnd, input.preRegisteredAt,
    evidenceCandidateIds, input.maxIncrementalSpendMinor,
    ...(creativeBrief ? ["BROS_SELL_CREATIVE_BRIEF_20261110", creativeBrief] : []),
  ])).digest("hex");
  return Object.freeze({
    candidateId, status: "PROPOSED_NOT_AUTHORIZED" as const,
    tenantId: input.tenantId.toLowerCase(), product: "demand" as const,
    pilotProduct: "bros_sell" as const,
    metaAccountId: input.metaAccountId, campaignId: input.campaignId,
    hypothesis: input.hypothesis.trim(), action: input.action,
    primaryKpi: input.primaryKpi,
    baselineStart: input.baselineStart, baselineEnd: input.baselineEnd,
    experimentStart: input.experimentStart, experimentEnd: input.experimentEnd,
    preRegisteredAt: input.preRegisteredAt, evidenceCandidateIds,
    ...(creativeBrief ? { creativeBrief } : {}),
    // A sequential baseline is observational. No concurrent randomized/holdout
    // group, assignment audit, or counterfactual has been verified here.
    experimentDesign: "SEQUENTIAL_BASELINE_NOT_CONTROLLED" as const,
    controlledExperimentVerified: false as const,
    causalInferenceEligible: false as const,
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
