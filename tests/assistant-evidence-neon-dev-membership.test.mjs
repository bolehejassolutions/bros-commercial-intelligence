import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessOsDevMembershipChecker, BusinessOsMembershipUnavailable } from "../lib/bci/assistant-evidence-neon-dev-membership.ts";

const P = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const selection = { tenantId: T, product: "demand" };
const role = {
  role_name: "bci_dev_membership_reader", session_role_name: "bci_dev_membership_reader",
  bypass_rls: false, superuser: false, can_login: true,
  inherits_roles: false, can_manage_roles: false, parent_role_count: 0,
};
const posture = {
  database_name: "bros_intelligence_dev", read_only_mode: "on",
  rls_enabled: true, rls_forced: true, can_read_membership: true,
  can_write_membership: false, can_access_evidence: false,
  can_create_schema_objects: false, can_create_database_objects: false,
};
const granted = { principal_id: P, tenant_id: T, product: "demand", active: true, revoked_at: null };
function fixture(options = {}) {
  const calls = [];
  const transaction = async fn => {
    if (options.failTransaction) throw Error("PRIVATE_DATABASE_SECRET");
    return fn(async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length === 1) return { rows: [options.role ?? role] };
      if (calls.length === 2) return { rows: [options.posture ?? posture] };
      if (calls.length === 3) return { rows: [options.scopeResult ?? {
        principal_scope: P, tenant_scope: T, product_scope: "demand",
      }] };
      return { rows: options.rows ?? [granted] };
    });
  };
  return { check: createBusinessOsDevMembershipChecker(transaction), calls };
}

test("verified principal, tenant and product are bound twice and only a single active membership grants access", async () => {
  const f = fixture();
  assert.equal(await f.check(P, selection), true);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.calls[2].params, [P, T, "demand"]);
  assert.deepEqual(f.calls[3].params, [P, T, "demand"]);
  assert.match(f.calls[3].sql, /principal_id=\$1::uuid AND tenant_id=\$2::uuid AND product=\$3::text/);
  assert.match(f.calls[3].sql, /active IS TRUE AND revoked_at IS NULL/);
  assert.match(f.calls[3].sql, /LIMIT 2/);
  assert.ok(!f.calls[3].sql.includes(P));
  assert.ok(!f.calls[3].sql.includes(T));
});

test("no active membership is a deny, not an empty-evidence grant", async () => {
  const f = fixture({ rows: [] });
  assert.equal(await f.check(P, selection), false);
});

test("cross-tenant, cross-product, wrong principal, revoked and inactive results fail closed", async () => {
  for (const row of [
    { ...granted, tenant_id: OTHER }, { ...granted, product: "content" },
    { ...granted, principal_id: OTHER }, { ...granted, active: false },
    { ...granted, revoked_at: "2026-11-08T10:00:00Z" },
    null, {}, [granted],
  ]) {
    await assert.rejects(fixture({ rows: [row] }).check(P, selection), BusinessOsMembershipUnavailable);
  }
});

test("duplicate grant rows fail closed instead of picking a convenient grant", async () => {
  await assert.rejects(fixture({ rows: [granted, granted] }).check(P, selection), BusinessOsMembershipUnavailable);
});

test("invalid subject, tenant and product fail before any SQL", async () => {
  const f = fixture();
  for (const [principal, scope] of [
    ["../../admin", selection], ["not-a-uuid", selection],
    [P, { tenantId: "org-A", product: "demand" }],
    [P, { tenantId: T, product: "sell" }], [P, null],
  ]) await assert.rejects(f.check(principal, scope), BusinessOsMembershipUnavailable);
  assert.equal(f.calls.length, 0);
});

test("admin SET ROLE and any role privilege drift fail before scoped SQL", async () => {
  for (const change of [
    { session_role_name: "BROS" }, { role_name: "BROS" },
    { bypass_rls: true }, { superuser: true }, { can_login: false },
    { inherits_roles: true }, { can_manage_roles: true }, { parent_role_count: 1 },
  ]) {
    const f = fixture({ role: { ...role, ...change } });
    await assert.rejects(f.check(P, selection), BusinessOsMembershipUnavailable);
    assert.equal(f.calls.length, 1);
  }
});

test("RLS, read-only, database and membership/evidence privileges must match", async () => {
  for (const change of [
    { database_name: "postgres" }, { read_only_mode: "off" },
    { rls_enabled: false }, { rls_forced: false },
    { can_read_membership: false }, { can_write_membership: true },
    { can_access_evidence: true }, { can_create_schema_objects: true },
    { can_create_database_objects: true },
  ]) {
    const f = fixture({ posture: { ...posture, ...change } });
    await assert.rejects(f.check(P, selection), BusinessOsMembershipUnavailable);
    assert.equal(f.calls.length, 2);
  }
});

test("transaction GUC mismatch and driver failure deny without exposing diagnostics", async () => {
  const f = fixture({ scopeResult: { principal_scope: OTHER, tenant_scope: T, product_scope: "demand" } });
  await assert.rejects(f.check(P, selection), BusinessOsMembershipUnavailable);
  assert.equal(f.calls.length, 3);
  const failing = fixture({ failTransaction: true });
  await assert.rejects(failing.check(P, selection), err =>
    err instanceof BusinessOsMembershipUnavailable && !err.message.includes("PRIVATE_DATABASE_SECRET"));
});
