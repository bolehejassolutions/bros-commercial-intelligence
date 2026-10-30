import { normalizeMetaCampaignFunnel } from "./meta-insights-funnel.ts";
import type { MetaFunnelScope, MetaCampaignInsight } from "./meta-insights-funnel.ts";

/**
 * BROS DEMAND internal: direct, READ-ONLY Meta Marketing API campaign insight.
 *
 * No HYPD/Supermetrics dependency. This is a SERVER-SIDE TRANSPORT, not an
 * authenticated product route, a durable BCI receipt or an ad executor.
 * Caller MUST verify the tenant/principal, load the token from protected
 * server secrets and authorize the exact account/campaign before invoking.
 * Never accept a token, account, tenant or campaign from public client input.
 *
 * Intentionally one bounded synchronous report (one campaign, one window).
 * Incomplete pagination, async reports, partial rows and API errors fail
 * closed. An empty report is UNKNOWN, not zero spend or zero conversions.
 */
type MetaResponse = Readonly<{
  ok: boolean;
  json(): Promise<unknown>;
}>;
export type ReadOnlyMetaFetch = (
  url: string,
  init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal },
) => Promise<MetaResponse>;

export type DirectMetaCampaignRequest = Readonly<{
  scope: MetaFunnelScope;
  /** Pin an explicitly reviewed supported Marketing API version, e.g. v26.0. */
  apiVersion: string;
  /** Obtain server-side only. Never persist, print or send to a browser. */
  accessToken: string;
  fetchImpl?: ReadOnlyMetaFetch;
}>;

const reject = (): never => {
  // Deliberately sanitized: Meta errors can contain account data or tokens.
  throw new Error("BROS_DEMAND_DIRECT_META_READ_FAILED");
};
const versionPattern = /^v[1-9][0-9]?\.[0-9]+$/;
const campaignPattern = /^[0-9]+$/;
const tokenPattern = /^[\x21-\x7e]{20,4096}$/;
const ALLOWED_FIELDS = [
  "account_id", "account_currency", "campaign_id",
  "date_start", "date_stop", "spend", "impressions",
  "reach", "clicks", "inline_link_clicks", "actions",
].join(",");

/**
 * A complete 1-row campaign report is an observation only.
 * Do not use Meta Purchase action aliases as reconciled HitPay sales.
 */
export async function readDirectMetaCampaignInsights(
  input: DirectMetaCampaignRequest,
) {
  try {
    if (!input || !input.scope ||
        typeof input.apiVersion !== "string" ||
        !versionPattern.test(input.apiVersion) ||
        typeof input.accessToken !== "string" ||
        !tokenPattern.test(input.accessToken) ||
        typeof input.scope.campaignId !== "string" ||
        !campaignPattern.test(input.scope.campaignId) ||
        typeof input.scope.accountId !== "string" ||
        !/^act_[0-9]+$/.test(input.scope.accountId)) reject();

    const scope = input.scope;
    // Existing strict normalizer validates tenant/product, MYR, date ranges,
    // future MYT dates and UTC collection timestamp before any HTTP call.
    normalizeMetaCampaignFunnel(scope, {
      campaign_id: scope.campaignId,
      date_start: scope.since, date_stop: scope.until,
    });

    const params = new URLSearchParams();
    params.set("fields", ALLOWED_FIELDS);
    params.set("level", "campaign");
    params.set("time_range", JSON.stringify({ since: scope.since, until: scope.until }));
    params.set("limit", "100");
    const url = "https://graph.facebook.com/" + input.apiVersion + "/" +
      scope.campaignId + "/insights?" + params.toString();
    const request = input.fetchImpl ?? (fetch as ReadOnlyMetaFetch);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    let payload: unknown;
    try {
      const response = await request(url, {
        method: "GET",
        // Token never goes into URL, logs, exception messages or return data.
        headers: {
          Authorization: "Bearer " + input.accessToken,
          Accept: "application/json",
        },
        signal: abort.signal,
      });
      if (!response || response.ok !== true) reject();
      payload = await response.json();
    } finally {
      clearTimeout(timer);
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) reject();
    const body = payload as Record<string, unknown>;
    if (Object.hasOwn(body, "error") || !Array.isArray(body.data) ||
        body.data.length > 1) reject();
    // Do NOT follow paging.next (untrusted URL with possible token contents).
    // A partially loaded report is neither complete nor authoritative.
    if (body.paging !== undefined) {
      if (!body.paging || typeof body.paging !== "object" ||
          Array.isArray(body.paging)) reject();
      if (Object.hasOwn(body.paging, "next")) reject();
    }
    if (body.data.length === 0) {
      return Object.freeze({
        status: "NO_ROWS_NOT_ZERO" as const,
        observation: null,
        source: "DIRECT_META_GRAPH_API" as const,
        providerAuthenticationIndependentlyAttested: false as const,
        tenantAuthorizationIndependentlyAttested: false as const,
        verifiedPaidOrders: null, verifiedCpaMinor: null,
        causalLift: null, executionAllowed: false as const,
      });
    }

    const row = body.data[0];
    if (!row || typeof row !== "object" || Array.isArray(row)) reject();
    const raw = row as Record<string, unknown>;
    if (raw.account_id !== scope.accountId.slice(4) ||
        raw.account_currency !== scope.currency ||
        raw.campaign_id !== scope.campaignId ||
        raw.date_start !== scope.since || raw.date_stop !== scope.until) reject();

    const insight: MetaCampaignInsight = {
      campaign_id: scope.campaignId,
      date_start: scope.since, date_stop: scope.until,
      ...(Object.hasOwn(raw, "spend") ? { spend: raw.spend as string | number } : {}),
      ...(Object.hasOwn(raw, "impressions") ? { impressions: raw.impressions as string | number } : {}),
      ...(Object.hasOwn(raw, "reach") ? { reach: raw.reach as string | number } : {}),
      ...(Object.hasOwn(raw, "clicks") ? { clicks: raw.clicks as string | number } : {}),
      ...(Object.hasOwn(raw, "inline_link_clicks") ?
        { inline_link_clicks: raw.inline_link_clicks as string | number } : {}),
      ...(Object.hasOwn(raw, "actions") ?
        { actions: raw.actions as MetaCampaignInsight["actions"] } : {}),
    };
    const observation = normalizeMetaCampaignFunnel(scope, insight);
    return Object.freeze({
      status: "CAMPAIGN_ROW_OBSERVED_UNATTESTED" as const,
      observation,
      source: "DIRECT_META_GRAPH_API" as const,
      // Even a successful GET is not a BCI-signed receipt or a verified
      // authenticated tenant. Separate trusted server admission required.
      providerAuthenticationIndependentlyAttested: false as const,
      tenantAuthorizationIndependentlyAttested: false as const,
      verifiedPaidOrders: null, verifiedCpaMinor: null,
      causalLift: null, executionAllowed: false as const,
    });
  } catch {
    reject();
  }
}
