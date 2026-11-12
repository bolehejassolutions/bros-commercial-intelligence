import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessOsDevReadOnlyTransaction } from "../lib/bci/assistant-evidence-neon-dev-readonly-transaction.ts";
import { createBusinessOsDevMembershipChecker } from "../lib/bci/assistant-evidence-neon-dev-membership.ts";
import { createBusinessOsDevScopedEvidenceReader } from "../lib/bci/assistant-evidence-neon-dev-read.ts";

// Contract-level PostgreSQL protocol simulator, NOT a running PostgreSQL server.
// Each restricted reader gets its own direct-login identity and pinned client.
const principal = "11111111-1111-4111-8111-111111111111";
const tenantA = "22222222-2222-4222-8222-222222222222";
const tenantB = "33333333-3333-4333-8333-333333333333";
const evidenceId = "44444444-4444-4444-8444-444444444444";
const time = "2026-11-09T08:00:00.000Z";
function fixture(role, { grant = true, wrongRole = false, wrongTenant = false,
  wrongProduct = false, failEvidence = false } = {}) {
  const trace = [], releases = [];
  let connected = 0, active = false, readOnly = false, scoped = {};
  const client = {
    async query(sql, params = []) {
      trace.push({ sql, params });
      if (sql.startsWith("BEGIN TRANSACTION")) {
        assert.equal(active, false);
        active = true; readOnly = true; scoped = {};
        return { rows: [] };
      }
      if (sql === "ROLLBACK") {
        assert.equal(active, true);
        active = false; scoped = {}; return { rows: [] };
      }
      assert.equal(active, true, "SQL must stay within pinned transaction");
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      if (sql.includes("FROM pg_roles WHERE rolname")) return { rows: [{
        role_name: wrongRole ? "administrator" : role,
        session_role_name: role, bypass_rls: false, superuser: false,
        is_superuser: false, can_login: true, inherits_roles: false,
        can_manage_roles: false, parent_role_count: 0,
        can_create_database: false, can_replicate: false,
      }] };
      if (sql.includes("FROM pg_class c JOIN pg_namespace n")) {
        const membership = role === "bci_dev_membership_reader";
        return { rows: [{
          database_name: "bros_intelligence_dev", read_only_mode: readOnly ? "on" : "off",
          rls_enabled: true, rls_forced: true,
          can_read_membership: membership, can_write_membership: false,
          can_access_evidence: false, can_read_evidence: !membership,
          can_write_evidence: false, can_access_memberships: false,
          can_create_schema_objects: false, can_create_database_objects: false,
          no_definer_exec: true, no_external_table_access: true,
        }] };
      }
      if (sql.includes("set_config(")) {
        if (role === "bci_dev_membership_reader") {
          assert.equal(params.length, 3);
          scoped = { principal: params[0], tenant: params[1], product: params[2] };
          return { rows: [{ principal_scope: params[0], tenant_scope: params[1],
            product_scope: params[2] }] };
        }
        assert.equal(params.length, 2);
        scoped = { tenant: params[0], product: params[1] };
        return { rows: [{ tenant_scope: params[0], product_scope: params[1] }] };
      }
      if (sql.includes("FROM bci_dev.tenant_memberships")) {
        assert.equal(role, "bci_dev_membership_reader");
        assert.deepEqual(params, [principal, scoped.tenant, scoped.product]);
        return { rows: grant && scoped.tenant === tenantA && scoped.product === "demand"
          ? [{ principal_id: principal, tenant_id: tenantA, product: "demand",
            active: true, revoked_at: null }] : [] };
      }
      if (sql.includes("FROM bci_dev.evidence")) {
        assert.equal(role, "bci_dev_private_reader");
        assert.deepEqual(params, [scoped.tenant, scoped.product, 20]);
        if (failEvidence) throw Error("PRIVATE_DATABASE_CREDENTIAL");
        if (scoped.tenant !== tenantA || scoped.product !== "demand") return { rows: [] };
        return { rows: [{
          evidenceId, tenantId: wrongTenant ? tenantB : tenantA,
          product: wrongProduct ? "content" : "demand",
          provider: "manual", collectedAt: time, observedAt: time,
          windowStart: null, windowEnd: null, completeness: "partial",
          metrics: { leads: null, purchases: 0 },
        }] };
      }
      throw Error("UNEXPECTED_SQL");
    },
    release(error) { releases.push(error); assert.equal(active, false); },
  };
  const pool = { async connect() { connected++; return client; } };
  return { transaction: createBusinessOsDevReadOnlyTransaction(pool),
    trace, releases, connected: () => connected };
}

test("two separate restricted direct-login transactions grant and project only matching scope", async () => {
  const m = fixture("bci_dev_membership_reader");
  const e = fixture("bci_dev_private_reader");
  const check = createBusinessOsDevMembershipChecker(m.transaction);
  const read = createBusinessOsDevScopedEvidenceReader(e.transaction);
  assert.equal(await check(principal, { tenantId: tenantA, product: "demand" }), true);
  const rows = await read({ tenantId: tenantA, product: "demand", maxRows: 20 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provenance.completeness, "partial");
  assert.deepEqual(rows[0].metrics, { leads: null, purchases: 0 });
  assert.equal(rows[0].provenance.providerObjectId, null);
  assert.equal(m.connected(), 1); assert.equal(e.connected(), 1);
  for (const f of [m, e]) {
    assert.equal(f.trace[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY");
    assert.equal(f.trace.at(-1).sql, "ROLLBACK");
    assert.deepEqual(f.releases, [undefined]);
  }
});

test("membership denial prevents evidence transaction from opening", async () => {
  const m = fixture("bci_dev_membership_reader", { grant: false });
  const e = fixture("bci_dev_private_reader");
  const allowed = await createBusinessOsDevMembershipChecker(m.transaction)(
    principal, { tenantId: tenantA, product: "demand" });
  assert.equal(allowed, false);
  if (allowed) await createBusinessOsDevScopedEvidenceReader(e.transaction)(
    { tenantId: tenantA, product: "demand", maxRows: 20 });
  assert.equal(e.connected(), 0);
});

test("cross-tenant and cross-product grant queries deny independently", async () => {
  for (const scope of [{ tenantId: tenantB, product: "demand" },
    { tenantId: tenantA, product: "content" }]) {
    const m = fixture("bci_dev_membership_reader");
    assert.equal(await createBusinessOsDevMembershipChecker(m.transaction)(principal, scope), false);
    assert.equal(m.trace.at(-1).sql, "ROLLBACK");
  }
});

test("direct-login role mismatch aborts before scoped SQL", async () => {
  for (const role of ["bci_dev_membership_reader", "bci_dev_private_reader"]) {
    const f = fixture(role, { wrongRole: true });
    const action = role === "bci_dev_membership_reader"
      ? () => createBusinessOsDevMembershipChecker(f.transaction)(principal,
        { tenantId: tenantA, product: "demand" })
      : () => createBusinessOsDevScopedEvidenceReader(f.transaction)(
        { tenantId: tenantA, product: "demand", maxRows: 20 });
    await assert.rejects(action);
    assert.equal(f.trace.some(x => x.sql.includes("set_config(")), false);
    assert.equal(f.trace.at(-1).sql, "ROLLBACK");
  }
});

test("evidence scope mismatch is denied even when simulated SQL returns wrong row", async () => {
  for (const opts of [{ wrongTenant: true }, { wrongProduct: true }]) {
    const f = fixture("bci_dev_private_reader", opts);
    await assert.rejects(() => createBusinessOsDevScopedEvidenceReader(f.transaction)(
      { tenantId: tenantA, product: "demand", maxRows: 20 }));
    assert.equal(f.trace.at(-1).sql, "ROLLBACK");
  }
});

test("database errors are suppressed and both connection and transaction are closed", async () => {
  const f = fixture("bci_dev_private_reader", { failEvidence: true });
  await assert.rejects(() => createBusinessOsDevScopedEvidenceReader(f.transaction)(
    { tenantId: tenantA, product: "demand", maxRows: 20 }),
    error => !error.message.includes("PRIVATE_DATABASE_CREDENTIAL"));
  assert.equal(f.trace.at(-1).sql, "ROLLBACK");
  assert.equal(f.releases.length, 1);
});
