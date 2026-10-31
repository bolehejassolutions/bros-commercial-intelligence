import test from "node:test";
import assert from "node:assert/strict";
import { projectHypdMetaCampaignReport } from "../lib/demand/hypd-meta-campaign-report.ts";

const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  product: "demand",
  accountId: "act_1997776120879476",
  campaignId: "120250864977630697",
  currency: "MYR",
  since: "2026-10-08",
  until: "2026-10-27",
  collectedAt: "2026-10-28T11:11:20Z",
};
const query = {
  accountId: scope.accountId, objectId: scope.campaignId,
  level: "campaign", since: scope.since, until: scope.until,
};
// Provider-shaped 28 Oct read-only HYPD result: HYPD omits campaign_id
// for an exact objectId query. Values are observations, NOT attestation.
const row = {
  date_start: scope.since, date_stop: scope.until,
  account_id: "1997776120879476", account_currency: "MYR", spend: 124.93,
  impressions: "3194", reach: "2041", clicks: "84",
  inline_link_clicks: "63",
  actions: [
    { action_type: "purchase", value: 1 },
    { action_type: "omni_purchase", value: 1 },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: 1 },
    { action_type: "landing_page_view", value: 33 },
  ],
  purchase_roas: [{ action_type: "omni_purchase", value: 0.400224 }],
  cost_per_action_type: [{ action_type: "purchase", value: 124.93 }],
};
const response = {
  rows: [row], nextPageToken: null, missingScopes: null,
};
const invalid = /Invalid BROS DEMAND HYPD campaign report|Invalid BROS DEMAND Meta insight/;

test("exact campaign query binds HYPD row lacking campaign_id; observed is not verified CPA", () => {
  const result = projectHypdMetaCampaignReport(scope, query, response);
  assert.equal(result.status, "CAMPAIGN_ROW_OBSERVED_UNATTESTED");
  assert.equal(result.identityBinding, "EXACT_CAMPAIGN_OBJECT_QUERY_UNATTESTED");
  assert.equal(result.observation.campaignId, scope.campaignId);
  assert.equal(result.observation.spendMinor, 12493);
  assert.equal(result.observation.inlineLinkClicks, 63);
  assert.equal(result.observation.landingPageViews, 33);
  assert.equal(result.observation.metaAttributedPurchases, 1);
  assert.equal(result.observation.pixelPurchaseEvents, 1);
  assert.equal(result.observation.hitpayPaidOrders, null);
  assert.equal(result.observation.verifiedCacMinor, null);
  assert.equal(result.verifiedCpaMinor, null);
  assert.equal(result.providerAuthenticationVerified, false);
  assert.equal(result.tenantAuthorizationVerified, false);
  assert.equal(result.causalLift, null);
  assert.equal(Object.isFrozen(result), true);
});

test("empty provider response means NO ROWS, not zero purchases or spend", () => {
  const result = projectHypdMetaCampaignReport(scope, query, {
    rows: [], nextPageToken: null, missingScopes: null,
  });
  assert.equal(result.status, "NO_ROWS_NOT_ZERO");
  assert.equal(result.observation, null);
  assert.equal(result.verifiedPaidOrders, null);
  assert.equal(result.verifiedCpaMinor, null);
  assert.equal(result.causalLift, null);
});

test("account-level, wrong object, wrong dates or foreign campaign cannot bind identity", () => {
  for (const changed of [
    { level: "account" },
    { accountId: "act_123" },
    { objectId: "999" },
    { since: "2026-10-09" },
    { until: "2026-10-26" },
  ]) assert.throws(
    () => projectHypdMetaCampaignReport(scope, { ...query, ...changed }, response), invalid);
  assert.throws(() => projectHypdMetaCampaignReport(scope, query, {
    ...response, rows: [{ ...row, campaign_id: "999" }],
  }), invalid);
  assert.throws(() => projectHypdMetaCampaignReport(scope, query, {
    ...response, rows: [{ ...row, account_currency: "USD" }],
  }), invalid);
  for (const account_id of [undefined, null, "1997776120879477", "act_1997776120879476", 1997776120879476]) {
    assert.throws(() => projectHypdMetaCampaignReport(scope, query, {
      ...response, rows: [{ ...row, account_id }],
    }), invalid);
  }
  assert.throws(() => projectHypdMetaCampaignReport(scope, query, {
    ...response, rows: [{ ...row, date_stop: "2026-10-26" }],
  }), invalid);
});

test("pagination, multiple rows, missing scopes or dropped fields fail closed", () => {
  for (const changed of [
    { rows: [row, row] },
    { nextPageToken: "next" },
    { missingScopes: ["ads_read"] },
    { droppedFields: ["spend"] },
    { rows: "not-an-array" },
  ]) assert.throws(
    () => projectHypdMetaCampaignReport(scope, query, { ...response, ...changed }), invalid);
});

test("provider revision is snapshot-distinct; repeated identical reads are idempotent", () => {
  const first = projectHypdMetaCampaignReport(scope, query, response);
  const replay = projectHypdMetaCampaignReport({
    ...scope, collectedAt: "2026-10-28T11:12:00Z",
  }, query, response);
  const revised = projectHypdMetaCampaignReport(scope, query, {
    ...response, rows: [{ ...row, spend: 125.93 }],
  });
  assert.equal(first.observation.snapshotKey, replay.observation.snapshotKey);
  assert.notEqual(first.observation.snapshotKey, revised.observation.snapshotKey);
  assert.equal(revised.observation.verifiedCacMinor, null);
});

test("even empty reports validate tenant, product and calendar scope", () => {
  const empty = { rows: [], nextPageToken: null, missingScopes: null };
  for (const patch of [
    { tenantId: ["11111111-1111-4111-8111-111111111111"] },
    { product: "content" },
    { until: "2026-10-29" },
  ]) assert.throws(
    () => projectHypdMetaCampaignReport({ ...scope, ...patch }, {
      ...query, until: patch.until ?? query.until,
    }, empty), invalid);
});
