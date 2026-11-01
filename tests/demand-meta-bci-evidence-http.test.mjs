import test from "node:test";
import assert from "node:assert/strict";
import { createDemandMetaBciEvidenceHandler } from "../lib/demand/meta-bci-evidence-http.ts";
import { createPgDemandEvidenceAppendTransaction } from "../lib/bci/neon-demand-evidence-append.ts";
import { RESTRICTED_EVIDENCE_WRITER_POLICIES } from "../lib/bci/neon-evidence-writer-policy-fingerprint.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const principal = "33333333-3333-4333-8333-333333333333";
const id = "44444444-4444-4444-8444-444444444444";
const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";
const secret = "EAA" + "s".repeat(50);
const url = "https://preview.example/api/internal/demand-meta-evidence";
const req = (patch = {}) => new Request(patch.url ?? url, {
  method: "POST", ...patch,
  headers: { Origin: "https://preview.example", Authorization: "Bearer " + jwt, ...patch.headers },
});
const identity = { roleName: "bci_dev_evidence_writer_restricted", sessionRoleName: "bci_dev_evidence_writer_restricted",
  canLogin: true, superuser: false, bypassRls: false, canCreateDb: false, canCreateRole: false,
  canReplicate: false, inherits: false, parentRoles: 0 };
const posture = { databaseName: "bros_intelligence_dev", forcedRls: true, canInsert: true,
  canSelect: true, noEvidenceMutation: true, canReadMembership: true, noMembershipMutation: true,
  noSchemaCreate: true, noDbCreate: true, noApprovalAccess: true };

function fixture(patch = {}) {
  const state = { row: null, auth: 0, reads: 0, commits: 0, connects: 0, membership: 0, sql: [] };
  const pool = { connect: async () => {
    state.connects++;
    let working = state.row;
    return { release() {}, query: async (sql, params = []) => {
      state.sql.push(sql);
      if (sql === "COMMIT") { state.row = working; state.commits++; return { rows: [] }; }
      if (sql.includes('AS "roleName"')) return { rows: [{ ...identity, ...patch.identity }] };
      if (sql.includes('AS "forcedRls"')) return { rows: [posture] };
      if (sql.includes("FROM pg_policies")) return { rows: patch.policies ?? RESTRICTED_EVIDENCE_WRITER_POLICIES };
      if (sql.includes("FROM bci_dev.tenant_memberships")) return { rows: [{ principalId: principal }] };
      if (sql.includes("INSERT INTO bci_dev.evidence")) {
        if (working) return { rows: [] };
        working = { id, tenant_id: params[0], product: params[1], provider: params[2],
          provider_record_key: params[3], source_reference: params[4], observed_at: params[5],
          period_start: params[6], period_end: params[7], collected_at: params[8], completeness: params[9],
          metrics: JSON.parse(params[10]), facts: JSON.parse(params[11]), unknowns: JSON.parse(params[12]) };
        return { rows: [{ id }] };
      }
      if (sql.includes("FROM bci_dev.evidence WHERE")) return { rows: working ? [
        patch.corruptReplay && state.commits > 0 ? { ...working, metrics: { spend_minor: 999 } } : working,
      ] : [] };
      return { rows: [] };
    } };
  } };
  const handler = createDemandMetaBciEvidenceHandler({ enabled: () => patch.enabled ?? true,
    accountId: "act_1997776120879476", tenantId: tenant, apiVersion: "v26.0",
    verifyJwt: async token => { state.auth++; return token === jwt && !patch.badIdentity
      ? { userId: principal, authenticated: true } : null; },
    membershipsFor: async user => {
      state.membership++;
      assert.equal(user, principal);
      if (patch.revokeAfterRead && state.reads > 0 || patch.revokeAfterCommit && state.commits > 0) return [];
      return [{ principalId: principal, tenantId: tenant, product: "demand", active: true }];
    },
    serverTokenFor: async (t, a) => { assert.equal(t, tenant); assert.equal(a, "act_1997776120879476"); return secret; },
    now: () => "2026-11-01T07:00:00Z",
    fetchImpl: async (u, init) => {
      state.reads++;
      const parsed = new URL(u);
      assert.equal(parsed.pathname, "/v26.0/120250864977630697/insights");
      assert.deepEqual(JSON.parse(parsed.searchParams.get("time_range")), { since: "2026-10-08", until: "2026-10-27" });
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Authorization, "Bearer " + secret);
      return { ok: true, json: async () => ({ data: patch.empty ? [] : [{
        account_id: "1997776120879476", account_currency: "MYR", campaign_id: "120250864977630697",
        date_start: "2026-10-08", date_stop: "2026-10-27", spend: "124.93", inline_link_clicks: "63",
        actions: [{ action_type: "purchase", value: "1" }, { action_type: "landing_page_view", value: "33" }],
      }] }) };
    }, transaction: createPgDemandEvidenceAppendTransaction(pool),
  });
  return { state, handler };
}

test("real DEMAND reader/projection plus shared BCI appender commit and replay one server-owned nonempty snapshot", async () => {
  const { state, handler } = fixture();
  const response = await handler(req());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "inserted", recordId: id, source: "DIRECT_META_GRAPH_API",
    durableBciEvidenceRecorded: true, postCommitReplayVerified: true, independentlyAttestedProvider: false,
    verifiedPaidOrders: null, campaignExecutionAllowed: false });
  assert.equal(state.reads, 1);
  assert.equal(state.connects, 2);
  assert.equal(state.commits, 2);
  assert.equal(state.row.metrics.spend_minor, 12493);
  assert.equal(state.row.metrics.meta_attributed_purchases, 1);
  assert.equal(state.row.completeness, "unverified");
  assert.equal(state.row.unknowns.includes("independent_provider_receipt_not_verified"), true);
  const again = await handler(req());
  assert.equal((await again.json()).status, "replayed");
  assert.equal(state.reads, 2); // one new observation per explicit POST; no global cache
  assert.equal(state.row.id, id);
  assert.equal(response.headers.get("vary"), "Authorization");
});

test("GET, missing JWT, query/body authority, cross-origin and scope headers cannot invoke the provider or SQL", async () => {
  for (const [request, status] of [
    [req({ method: "GET" }), 405],
    [req({ headers: { Authorization: "" } }), 401],
    [req({ body: JSON.stringify({ tenantId: tenant }) }), 400],
    [req({ url: url + "?campaignId=123" }), 400],
    [req({ headers: { Origin: "https://evil.example" } }), 400],
    [req({ headers: { "sec-fetch-site": "cross-site" } }), 400],
    [req({ headers: { "x-tenant-id": tenant } }), 400],
  ]) {
    const { state, handler } = fixture();
    assert.equal((await handler(request)).status, status);
    assert.equal(state.reads, 0);
    assert.equal(state.connects, 0);
  }
});

test("default-OFF and invalid signed identity deny before Meta and database access", async () => {
  for (const patch of [{ enabled: false }, { badIdentity: true }]) {
    const { state, handler } = fixture(patch);
    assert.equal((await handler(req())).status, patch.enabled === false ? 404 : 403);
    assert.equal(state.reads, 0);
    assert.equal(state.connects, 0);
  }
});

test("membership revoked during provider read prevents any append", async () => {
  const { state, handler } = fixture({ revokeAfterRead: true });
  assert.equal((await handler(req())).status, 403);
  assert.equal(state.reads, 1);
  assert.equal(state.connects, 0);
  assert.equal(state.row, null);
});

test("unknown empty reporting never becomes a persisted zero observation in this historical acceptance action", async () => {
  const { state, handler } = fixture({ empty: true });
  assert.equal((await handler(req())).status, 403);
  assert.equal(state.reads, 1);
  assert.equal(state.connects, 0);
  assert.equal(state.row, null);
});

test("admin impersonation and policy drift deny through the real shared BCI guard", async () => {
  for (const patch of [{ identity: { sessionRoleName: "BROS" } }, { policies: [] }]) {
    const { state, handler } = fixture(patch);
    const response = await handler(req());
    assert.equal(response.status, 403);
    const raw = await response.text();
    for (const value of [tenant, principal, secret, jwt]) assert.equal(raw.includes(value), false);
    assert.equal(state.row, null);
    assert.equal(state.commits, 0);
    assert.equal(state.sql.some(s => s.includes("INSERT INTO bci_dev.evidence")), false);
  }
});

test("revocation after first commit denies completion without concealing that a row already exists", async () => {
  const { state, handler } = fixture({ revokeAfterCommit: true });
  assert.equal((await handler(req())).status, 403);
  assert.equal(state.commits, 1);
  assert.equal(state.row.id, id);
});

test("conflicting post-commit readback cannot assert successful durable replay or overwrite the first row", async () => {
  const { state, handler } = fixture({ corruptReplay: true });
  const response = await handler(req());
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes("postCommitReplayVerified"), false);
  assert.equal(state.commits, 1);
  assert.equal(state.row.metrics.spend_minor, 12493);
  assert.equal(state.sql.some(s => /UPDATE bci_dev|DELETE FROM bci_dev/.test(s)), false);
});
