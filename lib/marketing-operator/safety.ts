/**
 * Deliberately immutable execution policy.
 * The current application has no Meta Marketing API write adapter.
 * A future live implementation requires a separate reviewed change and
 * independent operator approval; environment variables and user input
 * cannot enable writes in this release.
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
  constructor(public readonly operation: ExternalMutation) {
    super("DRY_RUN: external mutation blocked (" + operation + "). Explicit approval and a separate release are required.");
    this.name = "ExternalMutationBlocked";
  }
}

export function rejectExternalMutation(operation: ExternalMutation): never {
  throw new ExternalMutationBlocked(operation);
}
