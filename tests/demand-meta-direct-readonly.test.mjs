import test from "node:test";
import assert from "node:assert/strict";
import { readDirectMetaCampaignInsights } from "../lib/demand/meta-direct-readonly.ts";

const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  product: "demand", accountId: "act_1997776120879476",
  campaignId: "120251158023300697", currency: "MYR",
  since: "2026-10-29", until: "2026-10-29",
  collectedAt: "2026-10-30T01:00:00Z",
};
const accessToken = "EAA" + "z".repeat(40);
const raw = {
  account_id: "1997776120879476", account_currency: "MYR",
  campaign_id: scope.campaignId,
  date_start: scope.since, date_stop: scope.until,
  spend: "124.93", impressions: "3194", reach: "2041",
  clicks: "84", inline_link_clicks: "63",
  actions: [
    { action_type: "purchase", value: "1" },
    { action_type: "omni_purchase", value: "1" },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "1" },
    { action_type: "landing_page_view", value: "33" },
  ],
};
const ok = body => async () => ({ ok: true, json: async () => body });
const call = (fetchImpl, extra = {}) => readDirectMetaCampaignInsights({
  scope, apiVersion: "v26.0", accessToken, fetchImpl, ...extra,
});
const generic = /BROS_DEMAND_DIRECT_META_READ_FAILED/;

test("direct read uses Meta-only GET with bearer secret and expected campaign window", async () => {
  let called = 0;
  const fetchImpl = async (url, init) => {
    called++;
    const u = new URL(url);
    assert.equal(u.hostname, "graph.facebook.com");
    assert.equal(u.pathname, "/v26.0/" + scope.campaignId + "/insights");
    assert.equal(u.searchParams.get("level"), "campaign");
    assert.equal(u.searchParams.get("limit"), "100");
    assert.deepEqual(JSON.parse(u.searchParams.get("time_range")),
      { since: scope.since, until: scope.until });
    assert.equal(u.searchParams.get("fields").includes("account_currency"), true);
    assert.equal(url.includes(accessToken), false);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, "Bearer " + accessToken);
    assert.ok(init.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ data: [raw] }) };
  };
  const result = await call(fetchImpl);
  assert.equal(called, 1);
  assert.equal(result.status, "CAMPAIGN_ROW_OBSERVED_UNATTESTED");
  assert.equal(result.source, "DIRECT_META_GRAPH_API");
  assert.equal(result.observation.spendMinor, 12493);
  assert.equal(result.observation.inlineLinkClicks, 63);
  assert.equal(result.observation.landingPageViews, 33);
  assert.equal(result.observation.metaAttributedPurchases, 1);
  assert.equal(result.observation.pixelPurchaseEvents, 1);
  assert.equal(result.observation.hitpayPaidOrders, null);
  assert.equal(result.observation.verifiedCacMinor, null);
  assert.equal(result.verifiedPaidOrders, null);
  assert.equal(result.verifiedCpaMinor, null);
  assert.equal(result.providerAuthenticationIndependentlyAttested, false);
  assert.equal(result.tenantAuthorizationIndependentlyAttested, false);
  assert.equal(result.executionAllowed, false);
  assert.equal(JSON.stringify(result).includes(accessToken), false);
});

test("empty report stays unknown, never fabricates zero spend or sales", async () => {
  const result = await call(ok({ data: [] }));
  assert.equal(result.status, "NO_ROWS_NOT_ZERO");
  assert.equal(result.observation, null);
  assert.equal(result.verifiedPaidOrders, null);
  assert.equal(result.executionAllowed, false);
  const zero = await call(ok({ data: [{
    ...raw, spend: "0.00", actions: [{ action_type: "purchase", value: "0" }],
  }] }));
  assert.equal(zero.observation.spendMinor, 0);
  assert.equal(zero.observation.metaAttributedPurchases, 0);
  assert.equal(zero.verifiedPaidOrders, null);
});

test("mixed accounts, campaigns, windows, currencies and row count fail closed", async () => {
  for (const bad of [
    { ...raw, account_id: "1997776120879475" },
    { ...raw, account_currency: "USD" },
    { ...raw, account_currency: undefined },
    { ...raw, campaign_id: "999" },
    { ...raw, campaign_id: undefined },
    { ...raw, date_stop: "2026-10-30" },
    { ...raw, spend: "1.005" },
    { ...raw, actions: [{ action_type: "purchase", value: -1 }] },
  ]) await assert.rejects(call(ok({ data: [bad] })), generic);
  await assert.rejects(call(ok({ data: [raw, raw] })), generic);
  await assert.rejects(call(ok({ data: "not-an-array" })), generic);
});

test("never follow untrusted Meta paging.next, error payload or partial report", async () => {
  await assert.rejects(call(ok({ data: [raw], paging: {
    next: "https://evil.example/collect?access_token=" + accessToken,
  } })), generic);
  await assert.rejects(call(ok({ error: { message: "my_secret=" + accessToken } })), generic);
  await assert.rejects(call(async () => ({ ok: false, json: async () => ({}) })), generic);
  await assert.rejects(call(async () => {
    throw new Error("provider failure: " + accessToken);
  }), generic);
});

test("invalid token, API version or caller-controlled scope refused before network", async () => {
  let calls = 0;
  const network = async () => { calls++; return { ok: true, json: async () => ({ data: [raw] }) }; };
  for (const extra of [
    { apiVersion: "https://evil.example" },
    { apiVersion: "v26.0/../foo" },
    { accessToken: "short" },
    { accessToken: "EAA_secret\nInjected: header" },
    { scope: { ...scope, tenantId: "not-uuid" } },
    { scope: { ...scope, product: "content" } },
    { scope: { ...scope, accountId: "not-an-account" } },
    { scope: { ...scope, campaignId: "bad/id" } },
    { scope: { ...scope, until: "2026-11-30" } },
  ]) await assert.rejects(call(network, extra), generic);
  assert.equal(calls, 0);
});

test("replay gives stable normalized snapshot but changed report remains distinct", async () => {
  const first = await call(ok({ data: [raw] }));
  const replay = await call(ok({ data: [raw] }));
  const changed = await call(ok({ data: [{ ...raw, spend: "125.93" }] }));
  assert.equal(first.observation.snapshotKey, replay.observation.snapshotKey);
  assert.notEqual(first.observation.snapshotKey, changed.observation.snapshotKey);
  assert.equal(changed.verifiedPaidOrders, null);
  assert.equal(changed.causalLift, null);
});
