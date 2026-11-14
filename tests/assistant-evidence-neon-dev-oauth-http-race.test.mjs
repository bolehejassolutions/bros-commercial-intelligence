import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessOsDevOAuthReadHandler } from "../lib/bci/assistant-evidence-neon-dev-oauth.ts";

// All fixtures are fabricated; no real Neon roles, users or sessions.
const tenant = "11111111-1111-4111-8111-111111111111";
const subject = "22222222-2222-4222-8222-222222222222";
const otherTenant = "33333333-3333-4333-8333-333333333333";
const issuer = "https://fixture.neonauth.example.test/neondb/auth";
const resource = "https://fixture.example.test/mcp";
const client = "https://fixture.example.test/oauth-client.json";
const clock = Date.parse("2026-11-09T09:00:00Z");
const url = (t = tenant, product = "demand") =>
  "https://dev.example.test/internal/dev/bros-business-os/evidence?tenant_id=" +
  t + "&product=" + product;
const req = (t = tenant, product = "demand") => new Request(url(t, product), {
  headers: { authorization: "Bearer synthetic.jwt.signature" },
});
function setup({ revokedAfterRead = false, grantAfterRead = true, foreignRow = false,
  wrongProduct = false, expireAfterRead = false, failMembership = false,
  failEvidence = false } = {}) {
  let liveChecks = 0, membershipChecks = 0, membershipQueries = 0, evidenceQueries = 0;
  const membershipTransaction = async callback => callback(async (sql, params) => {
    membershipQueries++;
    if (failMembership) throw Error("PRIVATE_MEMBERSHIP_CONNECTION_SECRET");
    if (sql.includes("FROM pg_roles")) return { rows: [{
      role_name: "bci_dev_membership_reader", session_role_name: "bci_dev_membership_reader",
      bypass_rls: false, superuser: false, can_login: true, inherits_roles: false,
      can_manage_roles: false, can_create_database: false, can_replicate: false, parent_role_count: 0,
    }] };
    if (sql.includes("FROM pg_class")) return { rows: [{
      database_name: "bros_intelligence_dev", read_only_mode: "on",
      rls_enabled: true, rls_forced: true, can_read_membership: true,
      can_write_membership: false, can_access_evidence: false,
      can_create_schema_objects: false, can_create_database_objects: false,
      no_definer_exec: true, no_external_table_access: true,
    }] };
    if (sql.includes("set_config")) return { rows: [{
      principal_scope: params[0], tenant_scope: params[1], product_scope: params[2],
    }] };
    if (sql.includes("FROM bci_dev.tenant_memberships")) {
      membershipChecks++;
      if (membershipChecks > 1 && !grantAfterRead) return { rows: [] };
      if (params[1] !== tenant || params[2] !== "demand") return { rows: [] };
      return { rows: [{
        principal_id: params[0], tenant_id: params[1], product: params[2],
        active: true, revoked_at: null,
      }] };
    }
    throw Error("unexpected membership query");
  });
  const evidenceTransaction = async callback => callback(async (sql, params) => {
    evidenceQueries++;
    if (failEvidence) throw Error("PRIVATE_EVIDENCE_CONNECTION_SECRET");
    if (sql.includes("FROM pg_roles")) return { rows: [{
      role_name: "bci_dev_private_reader", session_role_name: "bci_dev_private_reader",
      bypass_rls: false, is_superuser: false, can_login: true,
      can_create_database: false, can_manage_roles: false, can_replicate: false,
      inherits_roles: false, parent_role_count: 0,
    }] };
    if (sql.includes("FROM pg_class")) return { rows: [{
      database_name: "bros_intelligence_dev", read_only_mode: "on",
      rls_enabled: true, rls_forced: true, can_read_evidence: true,
      can_write_evidence: false, can_access_memberships: false,
      can_create_schema_objects: false, can_create_database_objects: false,
      no_definer_exec: true, no_external_table_access: true,
    }] };
    if (sql.includes("set_config")) return { rows: [{
      tenant_scope: params[0], product_scope: params[1],
    }] };
    if (sql.includes("FROM bci_dev.evidence")) {
      assert.deepEqual(params, [tenant, "demand", 20]);
      return { rows: [{
        evidenceId: "44444444-4444-4444-8444-444444444444",
        tenantId: foreignRow ? otherTenant : tenant,
        product: wrongProduct ? "content" : "demand",
        provider: "manual", collectedAt: "2026-11-09T08:00:00.000Z",
        observedAt: "2026-11-09T08:00:00.000Z",
        windowStart: null, windowEnd: null, completeness: "unverified",
        metrics: { leads: null },
      }] };
    }
    throw Error("unexpected evidence query");
  });
  const handler = createBusinessOsDevOAuthReadHandler({
    config: { issuer, resource, allowedClientIds: [client] },
    now: () => expireAfterRead && liveChecks > 1 ? clock + 1_500_000 : clock,
    verifySignedAccessToken: async () => ({
      iss: issuer, aud: [resource], sub: subject, client_id: client,
      exp: Math.floor(clock / 1000) + 1200,
    }),
    verifyLiveTokenStatus: async () => {
      liveChecks++;
      return !(revokedAfterRead && liveChecks > 1);
    },
    membershipTransaction, evidenceTransaction,
  });
  return {
    handler,
    counts: () => ({ liveChecks, membershipChecks, membershipQueries, evidenceQueries }),
  };
}
test("valid synthetic scoped HTTP read preserves unknown-null semantics, with two live checks", async () => {
  const h = setup();
  const response = await h.handler(req());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes("synthetic.jwt.signature"));
  assert.ok(!JSON.stringify(body).includes("PRIVATE_"));
  assert.deepEqual(h.counts().liveChecks, 2);
  assert.deepEqual(h.counts().membershipChecks, 2);
  assert.ok(h.counts().evidenceQueries >= 4);
});
test("revocation during SQL read denies disclosure and skips second membership query", async () => {
  const h = setup({ revokedAfterRead: true });
  const response = await h.handler(req());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(h.counts().liveChecks, 2);
  assert.equal(h.counts().membershipChecks, 1);
});
test("product membership revoked during SQL read denies disclosure", async () => {
  const h = setup({ grantAfterRead: false });
  const response = await h.handler(req());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "access_denied" });
  assert.equal(h.counts().membershipChecks, 2);
});
test("expired token during SQL read denies disclosure", async () => {
  const h = setup({ expireAfterRead: true });
  const response = await h.handler(req());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
});
test("foreign tenant/product rows are denied, never projected", async () => {
  for (const change of [{ foreignRow: true }, { wrongProduct: true }]) {
    const h = setup(change);
    const response = await h.handler(req());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "read_unavailable" });
  }
});
test("cross-tenant and cross-product requests deny without opening evidence SQL", async () => {
  for (const [t, product] of [[otherTenant, "demand"], [tenant, "content"]]) {
    const h = setup();
    const response = await h.handler(req(t, product));
    assert.equal(response.status, 403);
    assert.equal(h.counts().evidenceQueries, 0);
  }
});
test("DB exceptions do not leak secrets or evidence", async () => {
  for (const change of [{ failMembership: true }, { failEvidence: true }]) {
    const h = setup(change);
    const response = await h.handler(req());
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.equal(text, '{"error":"read_unavailable"}');
    assert.ok(!text.includes("PRIVATE_"));
  }
});
