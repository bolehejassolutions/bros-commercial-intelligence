import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const script = new URL("../scripts/demand-hypd-readback.mjs", import.meta.url).pathname;
const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  product: "demand", accountId: "act_1997776120879476",
  campaignId: "120250864977630697", currency: "MYR",
  since: "2026-10-08", until: "2026-10-27",
  collectedAt: "2026-10-28T12:10:00Z",
};
const query = {
  accountId: scope.accountId, objectId: scope.campaignId,
  level: "campaign", since: scope.since, until: scope.until,
};
// Redacted, provider-observed HYPD response shape, 28 Oct 2026.
// Values are NOT provider-authenticated BCI evidence or paid orders.
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
};
const response = { rows: [row], nextPageToken: null, missingScopes: null };
const run = input => spawnSync(
  process.execPath, ["--experimental-strip-types", script],
  { input: JSON.stringify(input), encoding: "utf8", timeout: 10000 },
);

test("CLI replays real provider-shaped campaign observation without promoting sales or leaking raw data", () => {
  const first = run({ scope, query, response });
  assert.equal(first.status, 0, first.stderr);
  const a = JSON.parse(first.stdout);
  assert.equal(a.status, "CAMPAIGN_ROW_OBSERVED_UNATTESTED");
  assert.match(a.snapshotKey, /^meta_ads:sha256:[a-f0-9]{64}$/);
  assert.equal(a.spendMinor, 12493);
  assert.equal(a.inlineLinkClicks, 63);
  assert.equal(a.landingPageViews, 33);
  assert.equal(a.metaAttributedPurchases, 1);
  assert.equal(a.pixelPurchaseEvents, 1);
  assert.equal(a.providerAuthenticationVerified, false);
  assert.equal(a.tenantAuthorizationVerified, false);
  assert.equal(a.verifiedPaidOrders, null);
  assert.equal(a.verifiedCpaMinor, null);
  assert.equal(a.causalLift, null);
  assert.equal(a.verifiedOutcome, null);
  assert.equal(a.recordedLearning, null);
  assert.equal(first.stdout.includes(scope.tenantId), false);
  assert.equal(first.stdout.includes("sourceKey"), false);
  assert.equal(run({ scope, query, response }).stdout, first.stdout);
  const revised = JSON.parse(run({
    scope, query, response: { ...response, rows: [{ ...row, spend: 125.93 }] },
  }).stdout);
  assert.notEqual(revised.snapshotKey, a.snapshotKey);
});

test("CLI treats live HYPD no-row response as unknown, never zero", () => {
  const empty = run({
    scope: { ...scope, since: "2026-10-25" },
    query: { ...query, since: "2026-10-25" },
    response: { rows: [], nextPageToken: null, missingScopes: null },
  });
  assert.equal(empty.status, 0, empty.stderr);
  const a = JSON.parse(empty.stdout);
  assert.equal(a.status, "NO_ROWS_NOT_ZERO");
  assert.equal(a.spendMinor, null);
  assert.equal(a.metaAttributedPurchases, null);
  assert.equal(a.verifiedPaidOrders, null);
  assert.equal(a.verifiedCpaMinor, null);
});

test("CLI fails closed without echoing hostile input, credentials or provider payload", () => {
  for (const bad of [
    { scope, query: { ...query, level: "account" }, response },
    { scope, query, response: { ...response, nextPageToken: "page2" } },
    { scope, query, response: { ...response, rows: [{ ...row, campaign_id: "999" }] } },
    { scope, query, response: { ...response, rows: [{ ...row, account_id: "1997776120879477" }] } },
    { scope, query, response: { ...response, rows: [{ ...row, account_id: undefined }] } },
    { scope, query, response: { ...response, missingScopes: ["ads_read"] } },
  ]) {
    const x = run({ ...bad, secret: "DO_NOT_ECHO" });
    assert.equal(x.status, 2);
    assert.equal(x.stdout, "");
    assert.match(x.stderr, /DEMAND_HYPD_READBACK_REJECTED/);
    assert.equal(x.stderr.includes("DO_NOT_ECHO"), false);
  }
});
