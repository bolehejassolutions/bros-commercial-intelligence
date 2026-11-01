/** Product-owned draft text for a single DEV-only, reviewable BROS DEMAND proposal.
 * The BCI server pins the existing REVIEW case/receipt and enforces membership.
 * This payload is NOT an authorization, an execution instruction or a measured outcome.
 */
export const demandReviewProposal = Object.freeze({
  hypothesis: "First-party acquisition-to-order linkage may be incomplete; a verified checkout/order join is needed before attributing sales.",
  proposedAction: "Read-only audit of storefront UTM persistence and HitPay paid-charge/order identifiers; test stable joins in nonproduction, without changing live ads.",
  proposedSuccessMetric: "Independently verified first-party acquisition-to-paid-order joins (currently unknown).",
  confidence: "low" as const,
});

const REVIEW_CASE = "a474cd88-76a3-4c96-8cde-4fcfea45be83";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseDemandProposalResponse(value: unknown): {status: "inserted" | "replayed"; proposalId: string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid proposal result");
  const v = value as Record<string, unknown>;
  const keys = ["caseId", "proposalId", "status", "reviewOnly", "executionAuthorized", "providerAttested", "outcomeRecorded"];
  if (Object.keys(v).length !== keys.length || !Object.keys(v).every(key => keys.includes(key)) ||
      v.caseId !== REVIEW_CASE || typeof v.proposalId !== "string" || !UUID.test(v.proposalId) ||
      (v.status !== "inserted" && v.status !== "replayed") || v.reviewOnly !== true ||
      v.executionAuthorized !== false || v.providerAttested !== false || v.outcomeRecorded !== false)
    throw new Error("Invalid proposal result");
  return {status: v.status, proposalId: v.proposalId};
}
