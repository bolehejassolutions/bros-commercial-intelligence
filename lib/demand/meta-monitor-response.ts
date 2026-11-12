import type { readDemandOperatorSnapshot } from "./meta-operator-snapshot.ts";
import { isDemandMetaStatus } from "./meta-status-codes.ts";

export type DemandMonitorSnapshot = Omit<Awaited<ReturnType<typeof readDemandOperatorSnapshot>>, "tenantId" | "accountId"> & {
  source: "META_GRAPH_API_UNATTESTED";
  verifiedPaidOrders: null;
  providerAuthorizationIndependentlyAttested: false;
};

type ReportingWindow = Readonly<{ since: string; until: string }>;
const source = "META_GRAPH_API_UNATTESTED";
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const count = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const spend = (value: unknown): boolean =>
  typeof value === "number" && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value)) &&
  Number.isSafeInteger(Math.round(value * 100));

function isReport(value: unknown, window: ReportingWindow, accountId: string, observedAt: string): boolean {
  if (!record(value) || value.source !== source || value.executionAllowed !== false ||
      value.accountId !== accountId || value.since !== window.since || value.until !== window.until ||
      value.observedAt !== observedAt || !timestamp(value.collectedAt)) return false;
  if (value.state === "NO_ROWS_NOT_ZERO") {
    return value.spend === null && value.impressions === null && value.clicks === null;
  }
  return value.state === "PROVIDER_ROW" && spend(value.spend) && count(value.impressions) && count(value.clicks);
}

/** Validate both scopes before rendering any figures. The server still owns operator authorization. */
export function parseDemandMonitorResponse(value: unknown, window: ReportingWindow): DemandMonitorSnapshot | null {
  if (!record(value) || value.source !== source || value.executionAllowed !== false ||
      value.providerAuthorizationIndependentlyAttested !== false || value.verifiedPaidOrders !== null ||
      !timestamp(value.observedAt) || !timestamp(value.collectedAt) || value.collectedAt < value.observedAt) return null;

  const { account, status, insights, campaignInsights, observedAt } = value;
  if (!record(account) || typeof account.accountId !== "string" || !/^act_\d{5,30}$/.test(account.accountId) ||
      account.currency !== "MYR" || account.timezone !== "Asia/Kuala_Lumpur" || account.observedAt !== observedAt ||
      typeof account.statusCode !== "number" || !Number.isSafeInteger(account.statusCode) ||
      account.statusCode < 1 || account.statusCode > 999) return null;
  if (!record(status) || status.source !== source || status.executionAllowed !== false ||
      status.accountId !== account.accountId || status.observedAt !== observedAt || !Array.isArray(status.rows) ||
      status.rows.length < 1 || status.rows.length > 3) return null;

  const objects = new Map<string, string>();
  for (const row of status.rows) {
    if (!record(row) || row.source !== source || row.executionAllowed !== false ||
        row.providerAuthorizationIndependentlyAttested !== false || row.accountId !== account.accountId ||
        row.observedAt !== observedAt || typeof row.objectId !== "string" || !/^\d{5,30}$/.test(row.objectId) ||
        (row.kind !== "campaign" && row.kind !== "adset" && row.kind !== "ad") || objects.has(row.kind) ||
        !isDemandMetaStatus(row.configuredStatus) || !isDemandMetaStatus(row.effectiveStatus)) return null;
    objects.set(row.kind, row.objectId);
  }
  const campaignId = objects.get("campaign");
  if (!campaignId || (objects.has("ad") && !objects.has("adset")) ||
      new Set(objects.values()).size !== objects.size ||
      !record(campaignInsights) || campaignInsights.campaignId !== campaignId ||
      !isReport(campaignInsights, window, account.accountId, observedAt) ||
      !isReport(insights, window, account.accountId, observedAt)) return null;

  return value as DemandMonitorSnapshot;
}
