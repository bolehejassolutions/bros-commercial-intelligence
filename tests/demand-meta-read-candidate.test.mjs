import test from "node:test";
import assert from "node:assert/strict";
import { prepareDemandMetaReadCandidate } from "../lib/demand/meta-direct-read-candidate.ts";
import { normalizeMetaCampaignFunnel } from "../lib/demand/meta-insights-funnel.ts";

const tenantId = "22222222-2222-4222-8222-222222222222";
const scope = Object.freeze({
  tenantId, product: "demand", accountId: "act_1997776120879476",
  campaignId: "120251158023300697", currency: "MYR",
  since: "2026-10-28", until: "2026-10-29", collectedAt: "2026-10-30T02:00:00Z",
});
const providerRow = {
  campaign_id: scope.campaignId, date_start: scope.since, date_stop: scope.until,
  spend: "12.34", impressions: "100", inline_link_clicks: "10",
  actions: [{ action_type: "landing_page_view", value: 7 }],
};

test("NO_ROWS is a content-addressed but unverified candidate with ALL metrics unknown", () => {
  const candidate = prepareDemandMetaReadCandidate(scope, "NO_ROWS_NOT_ZERO", null);
  assert.equal(candidate.stage, "UNATTESTED_READ_CANDIDATE_ONLY");
  assert.equal(candidate.reportStatus, "NO_ROWS_NOT_ZERO");
  assert.equal(candidate.metrics, null);
  assert.equal(candidate.verifiedPaidOrders, null);
  assert.equal(candidate.verifiedCpaMinor, null);
  assert.equal(candidate.verifiedCacMinor, null);
  assert.equal(candidate.independentProviderReceiptRecorded, false);
  assert.equal(candidate.durableBciEvidenceRecorded, false);
  assert.equal(candidate.hitpayOrdersReconciled, false);
  assert.equal(candidate.executionAllowed, false);
  assert.match(candidate.candidateKey, /^demand:meta-read:sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(candidate).includes(tenantId), false);
  assert.equal(JSON.stringify(candidate).includes(scope.accountId), false);
  assert.equal(JSON.stringify(candidate).includes("EAA"), false);
});

test("identical empty content yields same logical key across collection times, but distinct timestamps", () => {
  const first = prepareDemandMetaReadCandidate(scope, "NO_ROWS_NOT_ZERO", null);
  const second = prepareDemandMetaReadCandidate(
    { ...scope, collectedAt: "2026-10-30T03:00:00Z" }, "NO_ROWS_NOT_ZERO", null);
  assert.equal(first.candidateKey, second.candidateKey);
  assert.notEqual(first.collectedAt, second.collectedAt);
  const otherWindow = prepareDemandMetaReadCandidate(
    { ...scope, since: "2026-10-27" }, "NO_ROWS_NOT_ZERO", null);
  const otherTenant = prepareDemandMetaReadCandidate(
    { ...scope, tenantId: "33333333-3333-4333-8333-333333333333" }, "NO_ROWS_NOT_ZERO", null);
  assert.notEqual(first.candidateKey, otherWindow.candidateKey);
  assert.notEqual(first.candidateKey, otherTenant.candidateKey);
});

test("reported spend is only an unverified observation; revised provider row changes key", () => {
  const a = normalizeMetaCampaignFunnel(scope, providerRow);
  const first = prepareDemandMetaReadCandidate(scope, "CAMPAIGN_ROW_OBSERVED_UNATTESTED", a);
  assert.equal(first.metrics.spendMinor, 1234);
  assert.equal(first.metrics.impressions, 100);
  assert.equal(first.metrics.landingPageViews, 7);
  assert.equal(first.metrics.inlineLinkClicks, 10);
  assert.equal(first.metrics.metaAttributedPurchases, null);
  assert.equal(first.verifiedPaidOrders, null);
  assert.notEqual(first.candidateKey,
    prepareDemandMetaReadCandidate(scope, "NO_ROWS_NOT_ZERO", null).candidateKey);
  const reread = prepareDemandMetaReadCandidate(scope,
    "CAMPAIGN_ROW_OBSERVED_UNATTESTED", normalizeMetaCampaignFunnel(scope, providerRow));
  assert.equal(first.candidateKey, reread.candidateKey);
  const revised = prepareDemandMetaReadCandidate(scope,
    "CAMPAIGN_ROW_OBSERVED_UNATTESTED",
    normalizeMetaCampaignFunnel(scope, { ...providerRow, spend: "12.35" }));
  assert.notEqual(first.candidateKey, revised.candidateKey);
});

test("explicit provider zero is distinct from a missing metric", () => {
  const zero = prepareDemandMetaReadCandidate(scope, "CAMPAIGN_ROW_OBSERVED_UNATTESTED",
    normalizeMetaCampaignFunnel(scope, { ...providerRow, spend: "0" }));
  const missing = prepareDemandMetaReadCandidate(scope, "CAMPAIGN_ROW_OBSERVED_UNATTESTED",
    normalizeMetaCampaignFunnel(scope, { ...providerRow, spend: undefined }));
  assert.equal(zero.metrics.spendMinor, 0);
  assert.equal(missing.metrics.spendMinor, null);
  assert.notEqual(zero.candidateKey, missing.candidateKey);
});

test("foreign observation, invented row, wrong date and future collection fail closed", () => {
  const observation = normalizeMetaCampaignFunnel(scope, providerRow);
  for (const [s, status, report] of [
    [scope, "NO_ROWS_NOT_ZERO", observation],
    [scope, "CAMPAIGN_ROW_OBSERVED_UNATTESTED", null],
    [{ ...scope, tenantId: "33333333-3333-4333-8333-333333333333" },
      "CAMPAIGN_ROW_OBSERVED_UNATTESTED", observation],
    [{ ...scope, campaignId: "1234" }, "CAMPAIGN_ROW_OBSERVED_UNATTESTED", observation],
    [{ ...scope, until: "2026-02-31" }, "NO_ROWS_NOT_ZERO", null],
    [{ ...scope, collectedAt: "not-utc" }, "NO_ROWS_NOT_ZERO", null],
    [scope, "VERIFIED_SUCCESS", observation],
  ]) {
    assert.throws(() => prepareDemandMetaReadCandidate(s, status, report),
      /Invalid DEMAND Meta read candidate/);
  }
});
