/**
 * INTERNAL BROS DEMAND: deterministic, read-only review of one approved
 * acquisition experiment. It neither executes an action nor establishes
 * causal lift, campaign attribution, a HitPay payout, or a verified identity.
 *
 * Call only with trusted server-adapter GrowthSummary objects and separately
 * attested approval/action/outcome references. The strings and flags below
 * are provenance contracts, NOT independent cryptographic attestations.
 */
import type { GrowthSummary } from "./growth-evidence-summary.ts";

export type DemandMetric = "qualified_leads" | "settled_orders";
export type DemandExperiment = Readonly<{
  experimentId: string;
  tenantId: string;
  diagnosisId: string;
  decisionId: string;
  actionId: string;
  actionKind: "organic" | "paid";
  /** Must be independently attested by the approval and provider adapters. */
  approvalVerified: boolean;
  actionVerified: boolean;
  actionEffectiveAt: string;
  /** Provider/measurement evidence reference; not an assertion of causality. */
  outcomeEvidenceId: string | null;
  outcomeVerified: boolean;
  primaryMetric: DemandMetric;
  /** Explicit cap required for paid experiments; no spending is performed here. */
  maxVerifiedSpendMinor: number | null;
}>;
export type DemandReviewStatus =
  | "action_unverified" | "outcome_unverified" | "spend_unverified"
  | "guardrail_exceeded" | "metric_unavailable" | "observed";
export type DemandExperimentReview = Readonly<{
  experimentId: string;
  tenantId: string;
  metric: DemandMetric;
  status: DemandReviewStatus;
  baselineCount: number | null;
  observedCount: number | null;
  observedDelta: number | null;
  observedChangeRatio: number | null;
  verifiedSpendMinor: number | null;
  learning: "insufficient_evidence" | "guardrail_exceeded" |
    "observed_increase" | "observed_decrease" | "observed_no_change";
  nextBestAction: "obtain_action_evidence" | "obtain_outcome_evidence" |
    "reconcile_spend" | "review_guardrail" | "review_hypothesis";
  attribution: "observational_only";
  causalLift: null;
  cpaMinor: null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const deny = (): never => { throw new Error("Invalid BROS DEMAND experiment review"); };
const validTime = (v: unknown): v is string => typeof v === "string" && UTC.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const count = (v: unknown): v is number | null => v === null ||
  (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
const reference = (v: unknown): v is string => typeof v === "string" &&
  v.length > 0 && v.length <= 160 && v.trim() === v;

export function reviewDemandExperiment(
  experiment: DemandExperiment,
  baseline: GrowthSummary,
  observed: GrowthSummary,
): DemandExperimentReview {
  if (!experiment || !baseline || !observed || !UUID.test(experiment.experimentId) ||
      !UUID.test(experiment.tenantId) || !UUID.test(experiment.diagnosisId) ||
      !UUID.test(experiment.decisionId) || !UUID.test(experiment.actionId) ||
      !["organic", "paid"].includes(experiment.actionKind) ||
      typeof experiment.approvalVerified !== "boolean" ||
      typeof experiment.actionVerified !== "boolean" ||
      typeof experiment.outcomeVerified !== "boolean" ||
      (experiment.outcomeEvidenceId !== null && !reference(experiment.outcomeEvidenceId)) ||
      !["qualified_leads", "settled_orders"].includes(experiment.primaryMetric) ||
      !validTime(experiment.actionEffectiveAt) ||
      !count(experiment.maxVerifiedSpendMinor) ||
      (experiment.actionKind === "paid" && experiment.maxVerifiedSpendMinor === null) ||
      baseline.scope?.tenantId !== experiment.tenantId ||
      observed.scope?.tenantId !== experiment.tenantId ||
      baseline.scope?.product !== "demand" || observed.scope?.product !== "demand" ||
      !validTime(baseline.scope.windowStart) || !validTime(baseline.scope.windowEnd) ||
      !validTime(observed.scope.windowStart) || !validTime(observed.scope.windowEnd) ||
      Date.parse(baseline.scope.windowStart) >= Date.parse(baseline.scope.windowEnd) ||
      Date.parse(observed.scope.windowStart) >= Date.parse(observed.scope.windowEnd) ||
      Date.parse(baseline.scope.windowEnd) > Date.parse(experiment.actionEffectiveAt) ||
      Date.parse(experiment.actionEffectiveAt) > Date.parse(observed.scope.windowStart) ||
      !count(baseline.qualifiedLeads) || !count(observed.qualifiedLeads) ||
      !count(baseline.settledOrders) || !count(observed.settledOrders) ||
      !count(observed.verifiedAdSpendMinor)) deny();

  const baselineCount = experiment.primaryMetric === "qualified_leads"
    ? baseline.qualifiedLeads : baseline.settledOrders;
  const observedCount = experiment.primaryMetric === "qualified_leads"
    ? observed.qualifiedLeads : observed.settledOrders;
  const spend = observed.verifiedAdSpendMinor;
  let status: DemandReviewStatus;
  if (!experiment.approvalVerified || !experiment.actionVerified) status = "action_unverified";
  else if (!experiment.outcomeVerified || !experiment.outcomeEvidenceId) status = "outcome_unverified";
  else if (experiment.actionKind === "paid" && spend === null) status = "spend_unverified";
  else if (experiment.maxVerifiedSpendMinor !== null && spend !== null &&
           spend > experiment.maxVerifiedSpendMinor) status = "guardrail_exceeded";
  else if (baselineCount === null || observedCount === null) status = "metric_unavailable";
  else status = "observed";

  // Counts are observational. No uplift, causal claim or campaign-level CPA.
  const delta = status === "observed" ? observedCount! - baselineCount! : null;
  const ratio = delta !== null && baselineCount! > 0 ? delta / baselineCount! : null;
  const learning = status === "guardrail_exceeded" ? "guardrail_exceeded" :
    status !== "observed" ? "insufficient_evidence" :
    delta! > 0 ? "observed_increase" : delta! < 0 ? "observed_decrease" : "observed_no_change";
  const nextBestAction = status === "action_unverified" ? "obtain_action_evidence" :
    status === "outcome_unverified" || status === "metric_unavailable" ? "obtain_outcome_evidence" :
    status === "spend_unverified" ? "reconcile_spend" :
    status === "guardrail_exceeded" ? "review_guardrail" : "review_hypothesis";
  return Object.freeze({
    experimentId: experiment.experimentId, tenantId: experiment.tenantId,
    metric: experiment.primaryMetric, status, baselineCount, observedCount,
    observedDelta: delta, observedChangeRatio: ratio, verifiedSpendMinor: spend,
    learning, nextBestAction, attribution: "observational_only" as const,
    causalLift: null, cpaMinor: null,
  });
}
