import test from "node:test";
import assert from "node:assert/strict";
import { createDemandDirectMetaReader } from "../lib/demand/meta-direct-admission.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const tenant = "22222222-2222-4222-8222-222222222222";
const accountId = "act_1997776120879476";
const campaignId = "120251158023300697";
const config = { accountId, campaignId, apiVersion: "v26.0" };
const range = { since: "2026-10-28", until: "2026-10-29" };
const now = "2026-10-30T02:00:00Z";
const token = "EAA" + "z".repeat(40);
const grant = { principalId: userId, tenantId: tenant, product: "demand", active: true };
const row = {
  account_id: accountId.slice(4), account_currency: "MYR", campaign_id: campaignId,
  date_start: range.since, date_stop: range.until, spend: "12.34",
  inline_link_clicks: "10", actions: [{ action_type: "landing_page_view", value: "7" }],
};
const valid = (extra = {}) => {
  const calls = { authentication: 0, memberships: 0, tokens: 0, http: 0 };
  const deps = {
    authenticate: async () => { calls.authentication++; return { userId, authenticated: true }; },
    membershipsFor: async (u, p) => {
      calls.memberships++;
      assert.equal(u, userId);
      assert.equal(p, "demand");
      return [grant];
    },
    serverTokenFor: async (t, a) => {
      calls.tokens++;
      assert.equal(t, tenant);
      assert.equal(a, accountId);
      return token;
    },
    now: () => now,
    fetchImpl: async (url, init) => {
      calls.http++;
      assert.equal(new URL(url).hostname, "graph.facebook.com");
      assert.equal(url.includes(token), false);
      assert.equal(new URL(url).pathname, "/v26.0/" + campaignId + "/insights");
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Authorization, "Bearer " + token);
      return { ok: true, json: async () => ({ data: [row] }) };
    },
    ...extra,
  };
  return { deps, calls };
};
const denied = /BROS_DEMAND_META_ADMISSION_DENIED/;

test("valid signed-principal dependency plus exact active membership gates one read", async () => {
  const { deps, calls } = valid();
  const report = await createDemandDirectMetaReader(config, deps)(range);
  assert.equal(report.status, "CAMPAIGN_ROW_OBSERVED_UNATTESTED");
  assert.equal(report.source, "DIRECT_META_GRAPH_API");
  assert.equal(report.observation.spendMinor, 1234);
  assert.equal(report.observation.inlineLinkClicks, 10);
  assert.equal(report.observation.landingPageViews, 7);
  assert.equal(report.admissionChecksApplied, true);
  assert.equal(report.membershipRecheckedAfterRead, true);
  assert.equal(report.authenticatedProviderReceiptRecorded, false);
  assert.equal(report.durableBciEvidenceRecorded, false);
  assert.equal(report.readCandidate.stage, "UNATTESTED_READ_CANDIDATE_ONLY");
  assert.match(report.readCandidate.candidateKey, /^demand:meta-read:sha256:[0-9a-f]{64}$/);
  assert.equal(report.readCandidate.metrics.spendMinor, 1234);
  assert.equal(report.readCandidate.independentProviderReceiptRecorded, false);
  assert.equal(report.readCandidate.durableBciEvidenceRecorded, false);
  assert.equal(report.verifiedPaidOrders, null);
  assert.equal(report.verifiedCpaMinor, null);
  assert.equal(report.executionAllowed, false);
  assert.deepEqual(calls, { authentication: 1, memberships: 2, tokens: 1, http: 1 });
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.equal(JSON.stringify(report).includes(userId), false);
});

test("reject forged user/tenant/account/campaign and unexpected request keys before auth", async () => {
  const { deps, calls } = valid();
  const reader = createDemandDirectMetaReader(config, deps);
  for (const bad of [
    { ...range, tenantId: tenant },
    { ...range, userId },
    { ...range, accountId },
    { ...range, campaignId },
    { ...range, product: "content" },
    { ...range, since: ["2026-10-28"] },
    { ...range, until: "2026-11-31" },
    { ...range, since: "2026-11-01", until: "2026-10-29" },
    { ...range, until: "2026-12-15" }, // > 31 days
    null,
  ]) await assert.rejects(reader(bad), denied);
  assert.deepEqual(calls, { authentication: 0, memberships: 0, tokens: 0, http: 0 });
});

test("invalid server binding and injected dependency refused without network", () => {
  const { deps } = valid();
  for (const bad of [
    { ...config, accountId: [accountId] },
    { ...config, campaignId: [campaignId] },
    { ...config, apiVersion: ["v26.0"] },
    { ...config, apiVersion: "v26.0?x=1" },
    { ...config, accountId: "act_error" },
    { ...config, campaignId: "campaign" },
  ]) assert.throws(() => createDemandDirectMetaReader(bad, deps), denied);
  for (const bad of [{ ...deps, authenticate: null }, { ...deps, membershipsFor: null },
    { ...deps, serverTokenFor: null }, { ...deps, now: null }]) {
    assert.throws(() => createDemandDirectMetaReader(config, bad), denied);
  }
});

test("unverified, missing or malformed principal prevents membership and HTTP", async () => {
  for (const principal of [null, { userId, authenticated: false },
    { userId: "foreign", authenticated: true },
    { userId: [userId], authenticated: true }]) {
    const { deps, calls } = valid({ authenticate: async () => {
      calls.authentication++; return principal;
    } });
    await assert.rejects(createDemandDirectMetaReader(config, deps)(range), denied);
    assert.equal(calls.memberships, 0);
    assert.equal(calls.http, 0);
  }
});

test("inactive, wrong-product, foreign, missing or ambiguous membership denies before token", async () => {
  for (const grants of [
    [], [null], [grant, grant],
    [{ ...grant, active: false }],
    [{ ...grant, product: "content" }],
    [{ ...grant, principalId: "33333333-3333-4333-8333-333333333333" }],
    [{ ...grant, tenantId: "not-uuid" }],
  ]) {
    const { deps, calls } = valid({ membershipsFor: async () => {
      calls.memberships++; return grants;
    } });
    await assert.rejects(createDemandDirectMetaReader(config, deps)(range), denied);
    assert.equal(calls.tokens, 0);
    assert.equal(calls.http, 0);
  }
});

test("missing server token and invalid clock deny before calling Meta", async () => {
  for (const patch of [
    { serverTokenFor: async () => null },
    { now: () => "2026-10-30T55:00:00Z" },
    { now: () => "2026-02-31T00:00:00Z" },
  ]) {
    const { deps, calls } = valid(patch);
    await assert.rejects(createDemandDirectMetaReader(config, deps)(range), denied);
    assert.equal(calls.http, 0);
  }
});

test("revoked or switched membership DURING Meta fetch fails closed", async () => {
  for (const second of [[], [{ ...grant, active: false }],
    [{ ...grant, tenantId: "44444444-4444-4444-8444-444444444444" }]]) {
    let reads = 0;
    const { deps, calls } = valid({ membershipsFor: async () => {
      reads++; return reads === 1 ? [grant] : second;
    } });
    await assert.rejects(createDemandDirectMetaReader(config, deps)(range), denied);
    assert.equal(calls.http, 1);
  }
});

test("provider failures are sanitized and do not leak access credentials", async () => {
  const { deps } = valid({
    fetchImpl: async () => { throw new Error("token " + token + " leaked"); },
  });
  let reason = "";
  try { await createDemandDirectMetaReader(config, deps)(range); }
  catch (e) { reason = String(e); }
  assert.match(reason, denied);
  assert.equal(reason.includes(token), false);
});

test("empty scoped Meta report remains unknown; no verified paid sale inferred", async () => {
  const { deps } = valid({
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [] }) }),
  });
  const result = await createDemandDirectMetaReader(config, deps)(range);
  assert.equal(result.status, "NO_ROWS_NOT_ZERO");
  assert.equal(result.observation, null);
  assert.equal(result.readCandidate.reportStatus, "NO_ROWS_NOT_ZERO");
  assert.equal(result.readCandidate.metrics, null);
  assert.equal(result.readCandidate.verifiedPaidOrders, null);
  assert.equal(result.readCandidate.durableBciEvidenceRecorded, false);
  assert.equal(result.verifiedPaidOrders, null);
  assert.equal(result.executionAllowed, false);
});
