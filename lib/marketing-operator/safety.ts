/**
 * Deliberately immutable execution policy.
 * This specific legacy analytics/simulation lane cannot mutate Meta.
 * Campaign Studio has a SEPARATE write adapter gated by provider credentials,
 * fixed deployment financial caps and per-plan authorizations.
 * No UI or environment setting can turn THIS analysis function into a write path.
 */
export const MARKETING_OPERATOR_POLICY = Object.freeze({
  market: "MY" as const,
  mode: "DRY_RUN" as const,
  maxAuthorizedSpendMYR: 0,
  externalWritesEnabled: false,
  publishingEnabled: false,
  automaticBudgetChangesEnabled: false,
});

export type ExternalMutation =
  | "create_campaign"
  | "edit_campaign"
  | "publish_ad"
  | "change_budget"
  | "pause_or_resume_ad"
  | "modify_audience";

export class ExternalMutationBlocked extends Error {
  public readonly operation: ExternalMutation;
  constructor(operation: ExternalMutation) {
    super("DRY_RUN: external mutation blocked (" + operation + "). Explicit approval and a separate release are required.");
    this.name = "ExternalMutationBlocked";
    this.operation = operation;
  }
}

export function rejectExternalMutation(operation: ExternalMutation): never {
  throw new ExternalMutationBlocked(operation);
}
