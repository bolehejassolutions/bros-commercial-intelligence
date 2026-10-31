import test from "node:test";
import assert from "node:assert/strict";
import { createDemandMetaHttpHandler } from "../lib/demand/meta-direct-http.ts";

const principalId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const config = { accountId: "act_1997776120879476",
  campaignId: "120251158023300697", apiVersion: "v26.0" };
const sourceRow = {
  account_id: config.accountId.slice(4), account_currency: "MYR",
  campaign_id: config.campaignId, date_start: "2026-10-28",
  date_stop: "2026-10-29", spend: "12.34",
  inline_link_clicks: "10",
  actions: [{ action_type: "landing_page_view", value: 7 }],
};
const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";
const secret = "EAA" + "s".repeat(50);
const make = (patch = {}) => {
  const events = { auth: 0, membership: 0, token: 0, network: 0 };
  const deps = {
    enabled: () => true, ...config,
    verifyJwt: async t => { events.auth++; assert.equal(t, jwt);
      return { userId: principalId, authenticated: true }; },
    membershipsFor: async (p, product) => { events.membership++;
      assert.equal(p, principalId); assert.equal(product, "demand");
      return [{ principalId, tenantId, active: true, product: "demand" }]; },
    serverTokenFor: async (tenant, account) => { events.token++;
      assert.equal(tenant, tenantId); assert.equal(account, config.accountId);
      return secret; },
    now: () => "2026-10-30T02:00:00Z",
    fetchImpl: async (url, init) => { events.network++;
      assert.equal(new URL(url).hostname, "graph.facebook.com");
      assert.equal(init.headers.Authorization, "Bearer " + secret);
      return { ok: true, json: async () => ({ data: [sourceRow] }) }; },
    ...patch,
  };
  return { handler: createDemandMetaHttpHandler(deps), events };
};
const url = "https://preview.example/api/internal/demand-meta?since=2026-10-28&until=2026-10-29";
const request = (u = url, options = {}) => new Request(u, {
  headers: { Authorization: "Bearer " + jwt, ...options.headers },
  ...options,
});

test("default-disabled preview rejects even authenticated request before any provider access", async () => {
  const { handler, events } = make({ enabled: () => false });
  const r = await handler(request());
  assert.equal(r.status, 404);
  assert.equal(events.auth, 0);
  assert.equal(events.network, 0);
  assert.equal(r.headers.get("cache-control").includes("no-store"), true);
});

test("one authorized read returns only minimized fields and no tenant/token/private data", async () => {
  const { handler, events } = make();
  const r = await handler(request());
  assert.equal(r.status, 200);
  const payload = await r.json();
  assert.equal(payload.status, "CAMPAIGN_ROW_OBSERVED_UNATTESTED");
  assert.equal(payload.report.campaignId, config.campaignId);
  assert.equal(payload.report.spendMinor, 1234);
  assert.equal(payload.report.landingPageViews, 7);
  assert.equal(payload.report.inlineLinkClicks, 10);
  assert.equal(payload.verifiedPaidOrders, null);
  assert.equal(payload.verifiedCpaMinor, null);
  assert.equal(payload.durableBciEvidenceRecorded, false);
  assert.equal(payload.readCandidate.stage, "UNATTESTED_READ_CANDIDATE_ONLY");
  assert.equal(payload.readCandidate.reportStatus, "CAMPAIGN_ROW_OBSERVED_UNATTESTED");
  assert.equal(payload.readCandidate.metricsPresent, true);
  assert.match(payload.readCandidate.candidateKey, /^demand:meta-read:sha256:[0-9a-f]{64}$/);
  assert.equal(payload.readCandidate.durableBciEvidenceRecorded, false);
  assert.equal(payload.readCandidate.independentProviderReceiptRecorded, false);
  assert.equal(payload.campaignExecutionAllowed, false);
  const raw = JSON.stringify(payload);
  for (const sensitive of [jwt, secret, principalId, tenantId]) {
    assert.equal(raw.includes(sensitive), false);
  }
  assert.deepEqual(events, { auth: 1, membership: 2, token: 1, network: 1 });
  assert.equal(r.headers.get("vary"), "Authorization");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("reject method writes and unauthenticated requests without contacting Meta", async () => {
  const { handler, events } = make();
  const post = await handler(request(url, { method: "POST", body: "{}" }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
  const noJwt = await handler(new Request(url));
  assert.equal(noJwt.status, 401);
  const invalid = await handler(request(url, { headers: { Authorization: "Bearer not.jwt" } }));
  assert.equal(invalid.status, 401);
  assert.equal(events.network, 0);
});

test("deny caller authority overrides, duplicate or extra query and wrong path", async () => {
  const { handler, events } = make();
  const urls = [
    url + "&tenantId=22222222-2222-4222-8222-222222222222",
    url + "&since=2026-10-20",
    url.replace("until=2026-10-29", "until=2026-10-29&token=some"),
    "https://preview.example/api/internal/other?since=2026-10-28&until=2026-10-29",
  ];
  for (const u of urls) assert.equal((await handler(request(u))).status, 400);
  for (const key of ["x-tenant-id", "x-user-id", "x-bci-tenant-id",
                     "x-admin", "x-role", "x-meta-token"]) {
    assert.equal((await handler(request(url, { headers: { [key]: "yes" } }))).status, 400);
  }
  assert.equal(events.network, 0);
});

test("missing or revoked membership and provider errors fail with sanitized 403", async () => {
  const bad = [
    { membershipsFor: async () => [] },
    { serverTokenFor: async () => null },
    { verifyJwt: async () => { throw Error("JWT=" + jwt); } },
    { fetchImpl: async () => { throw Error("SECRET=" + secret); } },
  ];
  for (const patch of bad) {
    const { handler } = make(patch);
    const res = await handler(request());
    assert.equal(res.status, 403);
    const body = await res.text();
    assert.equal(body.includes(jwt), false);
    assert.equal(body.includes(secret), false);
    assert.equal(body.includes(principalId), false);
  }
});

test("concurrent caller JWTs cannot share request-local identity", async () => {
  const alternate = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJvdGhlciJ9.c2lnbmF0dXJl";
  const log = [];
  const { handler, events } = make({
    verifyJwt: async t => {
      log.push(t);
      await Promise.resolve();
      return t === jwt ? { userId: principalId, authenticated: true } : null;
    },
  });
  const [good, bad] = await Promise.all([
    handler(request()), handler(request(url, { headers: { Authorization: "Bearer " + alternate } })),
  ]);
  assert.equal(good.status, 200);
  assert.equal(bad.status, 403);
  assert.deepEqual(new Set(log), new Set([jwt, alternate]));
  assert.equal(events.network, 1);
});

test("empty provider read remains UNKNOWN, not zero business spend or purchase", async () => {
  const { handler } = make({
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [] }) }),
  });
  const r = await handler(request());
  const payload = await r.json();
  assert.equal(payload.status, "NO_ROWS_NOT_ZERO");
  assert.equal(payload.report, null);
  assert.equal(payload.readCandidate.reportStatus, "NO_ROWS_NOT_ZERO");
  assert.equal(payload.readCandidate.metricsPresent, false);
  assert.equal(payload.readCandidate.durableBciEvidenceRecorded, false);
  assert.equal(payload.readCandidate.independentProviderReceiptRecorded, false);
  assert.equal(payload.verifiedPaidOrders, null);
});
