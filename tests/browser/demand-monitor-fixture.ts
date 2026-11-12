import { createDemandOperatorStatusHandler } from "@/lib/demand/meta-operator-http";

const accountId = "act_10000000001";
const campaignId = "20000000001";
const token = "demand.browser.fixture";
const metaToken = "synthetic-browser-meta-token";
const version = "v26.0";
const reply = (body: object) => ({ ok: true, json: async () => body });

export const handleDemandMetaOperatorStatus = createDemandOperatorStatusHandler({
  enabled: () => process.env.DEMAND_MONITOR_FIXTURE === "isolated_browser",
  accountId,
  campaignId,
  apiVersion: version,
  authorize: async candidate => {
    if (candidate !== token) throw Error("Unexpected fixture identity");
    return { principalId: "fixture_operator", tenantId: "fixture_tenant" };
  },
  readToken: () => metaToken,
  now: () => new Date(),
  transport: async (input, init) => {
    const url = new URL(input);
    if (url.origin !== "https://graph.facebook.com" || init.method !== "GET" ||
        init.headers.Authorization !== "Bearer " + metaToken) throw Error("Unexpected fixture provider request");

    const account = { account_id: accountId.slice(4) };
    if (url.pathname === `/${version}/${accountId}`) {
      return reply({ ...account, id: accountId, account_status: 1, currency: "MYR", timezone_name: "Asia/Kuala_Lumpur" });
    }
    if (url.pathname === `/${version}/${campaignId}`) {
      return reply({ ...account, id: campaignId, configured_status: "PAUSED", effective_status: "PAUSED" });
    }
    const campaignReport = url.pathname === `/${version}/${campaignId}/insights`;
    if (!campaignReport && url.pathname !== `/${version}/${accountId}/insights`) {
      throw Error("Unexpected fixture report scope");
    }
    if (url.searchParams.get("level") !== (campaignReport ? "campaign" : "account")) {
      throw Error("Unexpected fixture report level");
    }
    const { since, until } = JSON.parse(url.searchParams.get("time_range") ?? "{}");
    if (campaignReport && since === "2025-03-04") return reply({ data: [] });
    const zero = campaignReport && since === "2025-03-05";
    return reply({ data: [{
      ...account,
      ...(campaignReport ? { campaign_id: campaignId } : {}),
      account_currency: "MYR",
      date_start: since,
      date_stop: until,
      spend: campaignReport ? (zero ? "0" : "12.34") : "25.67",
      impressions: campaignReport ? (zero ? "0" : "315") : "900",
      clicks: campaignReport ? (zero ? "0" : "9") : "30",
    }] });
  },
});

export const handleDemandMetaPrivatePreview = () => new Response(null, { status: 404 });
