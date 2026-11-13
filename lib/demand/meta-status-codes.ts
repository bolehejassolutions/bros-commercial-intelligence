const statuses = new Set([
  "ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED",
  "ADSET_PAUSED", "DISAPPROVED", "PENDING_REVIEW", "PREAPPROVED", "PENDING_BILLING_INFO",
  "PENDING_BILLING_CAMPAIGN", "PENDING_BILLING_ADSET",
]);

export function isDemandMetaStatus(value: unknown): value is string {
  return typeof value === "string" && statuses.has(value);
}
