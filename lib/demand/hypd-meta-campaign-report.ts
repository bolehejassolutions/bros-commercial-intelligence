import { normalizeMetaCampaignFunnel } from "./meta-insights-funnel.ts";
import type { MetaCampaignInsight, MetaFunnelScope } from "./meta-insights-funnel.ts";

/**
 * BROS DEMAND-only read-only HYPD Meta Insights response bridge.
 *
 * The connected provider currently returns a campaign-scoped report row
 * without campaign_id even when objectId is the exact campaign. Identity is
 * therefore bound to the EXACT requested campaign object, not guessed from
 * an account-level aggregate or an unrelated campaign row.
 *
 * The query and response are caller-supplied: this is NOT proof of HYPD
 * authentication, provider signatures, tenant membership, a verified
 * conversion, or an executable campaign action. BCI owns trusted receipts.
 */
export type HypdCampaignQuery = Readonly<{
  accountId: string;
  objectId: string;
  level: "campaign";
  since: string;
  until: string;
}>;
export type HypdCampaignResponse = Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  nextPageToken: string | null;
  missingScopes: readonly string[] | null;
  droppedFields?: readonly string[] | null;
}>;

const fail = (): never => {
  throw new Error("Invalid BROS DEMAND HYPD campaign report");
};

export function projectHypdMetaCampaignReport(
  scope: MetaFunnelScope,
  query: HypdCampaignQuery,
  response: HypdCampaignResponse,
) {
  if (!scope || !query || !response ||
      typeof query.accountId !== "string" ||
      typeof query.objectId !== "string" ||
      query.accountId !== scope.accountId ||
      query.objectId !== scope.campaignId ||
      query.level !== "campaign" ||
      query.since !== scope.since || query.until !== scope.until ||
      !Array.isArray(response.rows) ||
      response.nextPageToken !== null ||
      (response.missingScopes !== null &&
        (!Array.isArray(response.missingScopes) || response.missingScopes.length > 0)) ||
      (response.droppedFields != null &&
        (!Array.isArray(response.droppedFields) || response.droppedFields.length > 0))) fail();

  // Validate scope even when the provider returned NO rows. A no-row report
  // is NOT an observation of zero spend, zero leads or zero purchases.
  if (response.rows.length === 0) {
    normalizeMetaCampaignFunnel(scope, {
      campaign_id: scope.campaignId,
      date_start: scope.since,
      date_stop: scope.until,
    });
    return Object.freeze({
      status: "NO_ROWS_NOT_ZERO" as const,
      identityBinding: "EXACT_CAMPAIGN_OBJECT_QUERY_UNATTESTED" as const,
      observation: null,
      verifiedPaidOrders: null,
      verifiedCpaMinor: null,
      causalLift: null,
      providerAuthenticationVerified: false as const,
      tenantAuthorizationVerified: false as const,
    });
  }

  // Never silently select one row from an account-wide or paginated report.
  if (response.rows.length !== 1) fail();
  const raw = response.rows[0];
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      raw.account_currency !== scope.currency ||
      raw.date_start !== scope.since || raw.date_stop !== scope.until ||
      (Object.hasOwn(raw, "campaign_id") &&
        raw.campaign_id !== scope.campaignId)) fail();

  // Project only supported Meta observations. Ignore provider-derived CPC,
  // cost_per_action_type and ROAS: they are not verified acquisition costs.
  const row: MetaCampaignInsight = {
    campaign_id: scope.campaignId,
    date_start: scope.since,
    date_stop: scope.until,
    ...(Object.hasOwn(raw, "spend") ? { spend: raw.spend as number | string } : {}),
    ...(Object.hasOwn(raw, "impressions") ? { impressions: raw.impressions as number | string } : {}),
    ...(Object.hasOwn(raw, "reach") ? { reach: raw.reach as number | string } : {}),
    ...(Object.hasOwn(raw, "clicks") ? { clicks: raw.clicks as number | string } : {}),
    ...(Object.hasOwn(raw, "inline_link_clicks")
      ? { inline_link_clicks: raw.inline_link_clicks as number | string } : {}),
    ...(Object.hasOwn(raw, "actions")
      ? { actions: raw.actions as MetaCampaignInsight["actions"] } : {}),
  };
  const observation = normalizeMetaCampaignFunnel(scope, row);
  return Object.freeze({
    status: "CAMPAIGN_ROW_OBSERVED_UNATTESTED" as const,
    identityBinding: "EXACT_CAMPAIGN_OBJECT_QUERY_UNATTESTED" as const,
    observation,
    verifiedPaidOrders: null,
    verifiedCpaMinor: null,
    causalLift: null,
    providerAuthenticationVerified: false as const,
    tenantAuthorizationVerified: false as const,
  });
}
