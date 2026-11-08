import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessOsDevComposedReadHandler } from "../lib/bci/assistant-evidence-neon-dev-composition.ts";

const P = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const E = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-11-08T12:00:00Z");
const issuer = "https://auth.example.test", audience = "bros-business-os-dev";
const url = (tenant = T, product = "demand") =>
  "https://dev.example/internal/dev/bros-business-os/evidence?tenant_id=" + tenant + "&product=" + product;
const request = (tenant = T, product = "demand") =>
  new Request(url(tenant, product), { headers: { authorization: "Bearer synthetic-token" } });
const receipt = {
  evidenceId: E, tenantId: T, product: "demand", provider: "meta_ads",
  collectedAt: "2026-11-08T04:00:00.000Z",
  observedAt: "2026-11-08T03:59:00.000Z",
  windowStart: null, windowEnd: null, completeness: "partial",
  metrics: { spend_myr: null, clicks: 0, paid_orders: null },
};

function fixture({ revokedAtCheck, membership = true, row = receipt, throwIdp = false,
  throwMembership = false, throwEvidence = false, expiry, changedSubject = false } = {}) {
  const calls = [];
  let checks = 0;
  const deps = {
    now: () => NOW, identity: { issuer, audience },
    introspect: async bearer => {
      calls.push("idp");
      assert.equal(bearer, "synthetic-token");
      if (throwIdp) throw Error("PRIVATE_IDP_SECRET");
      checks++;
      return {
        subjectId: changedSubject && checks > 1 ? OTHER : P,
        sessionId: "server-session", issuer, audience,
        expiresAt: expiry ?? "2026-11-08T12:10:00Z",
        revoked: revokedAtCheck === checks,
      };
    },
    membershipTransaction: async fn => {
      calls.push("membership-transaction");
      if (throwMembership) throw Error("PRIVATE_MEMBERSHIP_SECRET");
      return fn(async (sql, params) => {
        if (sql.includes("current_user AS role_name")) return { rows: [{
          role_name: "bci_dev_membership_reader", session_role_name: "bci_dev_membership_reader",
          bypass_rls: false, superuser: false, can_login: true, inherits_roles: false,
          can_manage_roles: false, parent_role_count: 0,
        }] };
        if (sql.includes("current_database()")) return { rows: [{
          database_name: "bros_intelligence_dev", read_only_mode: "on",
          rls_enabled: true, rls_forced: true, can_read_membership: true,
          can_write_membership: false, can_access_evidence: false,
          can_create_schema_objects: false, can_create_database_objects: false,
        }] };
        if (sql.includes("set_config")) return { rows: [{
          principal_scope: params[0], tenant_scope: params[1], product_scope: params[2],
        }] };
        if (sql.includes("FROM bci_dev.tenant_memberships")) {
          assert.deepEqual(params, [P, T, "demand"]);
          return { rows: membership ? [{
            principal_id: P, tenant_id: T, product: "demand", active: true, revoked_at: null,
          }] : [] };
        }
        throw Error("unexpected membership query");
      });
    },
    evidenceTransaction: async fn => {
      calls.push("evidence-transaction");
      if (throwEvidence) throw Error("PRIVATE_EVIDENCE_SECRET");
      return fn(async (sql, params) => {
        if (sql.includes("current_user AS role_name")) return { rows: [{
          role_name: "bci_dev_private_reader", session_role_name: "bci_dev_private_reader",
          bypass_rls: false, is_superuser: false, can_login: true,
          can_create_database: false, can_manage_roles: false, can_replicate: false,
          inherits_roles: false, parent_role_count: 0,
        }] };
        if (sql.includes("current_database()")) return { rows: [{
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
          assert.deepEqual(params, [T, "demand", 20]);
          return { rows: row ? [row] : [] };
        }
        throw Error("unexpected evidence query");
      });
    },
  };
  return { handler: createBusinessOsDevComposedReadHandler(deps), calls };
}

test("non-routed full DEV composition enforces identity, membership, scoped SQL, then rechecks both", async () => {
  const f = fixture();
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, ["idp", "membership-transaction", "evidence-transaction", "idp", "membership-transaction"]);
  const body = await response.json();
  assert.equal(body.access, "read_only");
  assert.equal(body.receipts.length, 1);
  assert.equal(body.receipts[0].metrics.spend_myr, null);
  assert.equal(body.receipts[0].metrics.clicks, 0);
  assert.ok(!JSON.stringify(body).includes("server-session"));
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("foreign tenant and unauthorized product never open evidence transaction", async () => {
  for (const [tenant, product] of [[OTHER, "demand"], [T, "content"]]) {
    const f = fixture({ membership: false });
    const res = await f.handler(request(tenant, product));
    assert.equal(res.status, 403);
    assert.deepEqual(f.calls, ["idp", "membership-transaction"]);
  }
});

test("revoked and expired IdP session denies before any SQL", async () => {
  for (const opts of [{ revokedAtCheck: 1 }, { expiry: "2026-11-08T11:59:59Z" }, { throwIdp: true }]) {
    const f = fixture(opts);
    const res = await f.handler(request());
    assert.equal(res.status, 401);
    assert.deepEqual(f.calls, ["idp"]);
  }
});

test("revoked or reassigned session after SQL cannot disclose evidence", async () => {
  for (const opts of [{ revokedAtCheck: 2 }, { changedSubject: true }]) {
    const f = fixture(opts);
    const res = await f.handler(request());
    assert.equal(res.status, 401);
    assert.deepEqual(f.calls, ["idp", "membership-transaction", "evidence-transaction", "idp"]);
    assert.ok(!(await res.text()).includes(E));
  }
});

test("membership or evidence failure masks secrets and fails closed", async () => {
  for (const opts of [{ throwMembership: true }, { throwEvidence: true }]) {
    const f = fixture(opts);
    const res = await f.handler(request());
    assert.equal(res.status, 503);
    const body = await res.text();
    assert.equal(body, JSON.stringify({ error: "read_unavailable" }));
    assert.ok(!body.includes("PRIVATE_"));
  }
});

test("genuinely empty scoped evidence is not falsely interpreted as zero performance", async () => {
  const f = fixture({ row: null });
  const res = await f.handler(request());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result, "NO_ROWS_NOT_ZERO");
});

test("missing server-owned dependencies reject at construction, not permissive fallback", () => {
  assert.throws(() => createBusinessOsDevComposedReadHandler({}));
  assert.throws(() => createBusinessOsDevComposedReadHandler(null));
});
