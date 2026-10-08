import { validateSnapshot } from "./engine";
import type { CampaignSnapshot } from "./contracts";

/** Meta retrieval is GET-only. Do not add POST/PATCH/DELETE to this module. */
const GRAPH_ROOT = "https://graph.facebook.com/v24.0";
const CAMPAIGN_NAME = /^BROS\\s*SELL/i;
const purchaseTypes = [
  "offsite_conversion.fb_pixel_purchase",
  "omni_purchase",
  "purchase",
] as const;

export interface MetaInsightRow {
  campaign_id?: string;
  campaign_name?: string;
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
}

function metric(value: unknown, label: string, integer: boolean) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    throw new Error("Invalid Meta " + label + " metric");
  }
  return number;
}

function actionValue(actions: MetaInsightRow["actions"], wanted: readonly string[]): number | null {
  if (!Array.isArray(actions)) return null;
  for (const actionType of wanted) {
    const a = actions.find(item => item.action_type === actionType);
    if (a) return metric(a.value, actionType, true);
  }
  return null;
}

function purchaseValue(row: MetaInsightRow): { purchases: number | null; revenue: number | null } {
  let purchaseActionType: string | null = null;
  for (const type of purchaseTypes) {
    if (row.actions?.some(a => a.action_type === type)) {
      purchaseActionType = type;
      break;
    }
  }
  if (!purchaseActionType) return { purchases: null, revenue: null };
  const purchases = actionValue(row.actions, [purchaseActionType]);
  const value = row.action_values?.find(a => a.action_type === purchaseActionType);
  const revenue = value ? metric(value.value, "purchase value", false) : null;
  return { purchases, revenue };
}

export function normalizeMetaInsight(
  row: MetaInsightRow,
  accountId: string,
  fetchedAt: string,
): { campaignId: string; snapshot: CampaignSnapshot } | null {
  if (!row.campaign_id || !/^\\d{6,}$/.test(row.campaign_id)) throw new Error("Invalid Meta campaign identifier");
  if (!CAMPAIGN_NAME.test(row.campaign_name ?? "")) return null;
  const { purchases, revenue } = purchaseValue(row);
  const dayStart = row.date_start ?? "";
  const dayEnd = row.date_stop ?? "";
  const snapshot: CampaignSnapshot = validateSnapshot({
    market: "MY",
    currency: "MYR",
    campaignName: row.campaign_name!,
    source: "meta-readonly-export",
    sourceReference: "Meta Graph API GET " + accountId + "/insights campaign_id=" + row.campaign_id,
    capturedAt: fetchedAt,
    periodStart: dayStart,
    periodEnd: dayEnd,
    spendMYR: metric(row.spend, "spend", false),
    impressions: metric(row.impressions, "impressions", true),
    linkClicks: metric(row.inline_link_clicks, "inline link clicks", true),
    landingPageViews: actionValue(row.actions, ["landing_page_view", "omni_landing_page_view"]),
    purchases,
    attributedRevenueMYR: revenue,
  });
  return { campaignId: row.campaign_id, snapshot };
}

function failWith(providerCode: number): never {
  if (providerCode === 429 || providerCode === 17 || providerCode === 4 || providerCode === 32 || providerCode === 613) {
    throw new Error("Meta rate limit; do not retry immediately.");
  }
  throw new Error("Meta read-only request failed (HTTP/provider code " + providerCode + ").");
}

export async function fetchMetaReadOnlyInsights(
  accountId: string,
  readToken: string,
  periodStart: string,
  periodEnd: string,
  transport: typeof fetch = fetch,
): Promise<MetaInsightRow[]> {
  if (!/^act_\\d{6,}$/.test(accountId)) throw new Error("Meta account allowlist is invalid.");
  if (!readToken || readToken.length < 16) throw new Error("Meta read-only credential is unavailable.");
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(periodStart) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(periodEnd) || periodEnd < periodStart) {
    throw new Error("Invalid date window.");
  }
  // No untrusted URL, account selection, fields or endpoint can reach this function.
  // Query exact two-day window or less; no uncontrolled historical scans.
  const duration = (Date.parse(periodEnd) - Date.parse(periodStart)) / 86400000;
  if (!Number.isFinite(duration) || duration > 1) throw new Error("Max read window is 2 calendar days.");
  const url = new URL(GRAPH_ROOT + "/" + accountId + "/insights");
  url.searchParams.set("level", "campaign");
  url.searchParams.set("time_range", JSON.stringify({ since: periodStart, until: periodEnd }));
  url.searchParams.set("fields", "campaign_id,campaign_name,date_start,date_stop,spend,impressions,inline_link_clicks,actions,action_values");
  url.searchParams.set("limit", "100");

  const items: MetaInsightRow[] = [];
  for (let page = 0; page < 3; page++) {
    const response = await transport(url.toString(), {
      method: "GET",
      headers: { Authorization: "Bearer " + readToken, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) failWith(response.status);
    const data = await response.json() as {
      data?: MetaInsightRow[];
      error?: { code?: number };
      paging?: { next?: string };
    };
    if (data.error) failWith(data.error.code ?? 502);
    if (!Array.isArray(data.data)) throw new Error("Meta returned an invalid insights payload.");
    items.push(...data.data);
    if (items.length > 300) throw new Error("Meta result cap exceeded.");
    if (!data.paging?.next) return items;
    const next = new URL(data.paging.next);
    // Reject potentially hostile pagination redirects; query must stay on Meta.
    if (next.origin !== "https://graph.facebook.com" || next.pathname !== url.pathname) {
      throw new Error("Unexpected pagination destination from Meta.");
    }
    url.search = next.search;
  }
  throw new Error("Meta result page cap reached. Narrow the query.");
}
