import test from "node:test";
import assert from "node:assert/strict";
import { createNeonDevMembershipLookup, NeonMembershipAccessDenied } from "../lib/bci/neon-dev-membership-rows.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const membership = { principalId: USER, tenantId: TENANT, product: "content", active: true, revokedAt: null };
function fixture({ role = "bci_dev_membership_reader", sessionRole = role,
  bypass = false, superuser = false, canLogin = true,
  canCreateDatabase = false, canManageRoles = false, canReplicate = false,
  inheritsRoles = false, parentRoleCount = 0, posture = {}, rows = [membership],
  errorAt = -1 } = {}) {
  const calls = [];
  const transaction = async fn => {
    calls.push({ sql: "BEGIN", params: [] });
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length - 1 === errorAt) throw new Error("DB offline");
      if (sql.includes("current_user AS role_name")) return { rows: [{ role_name: role,
        session_role_name: sessionRole, bypass_rls: bypass, is_superuser: superuser,
        can_login: canLogin, can_create_database: canCreateDatabase,
        can_manage_roles: canManageRoles, can_replicate: canReplicate,
        inherits_roles: inheritsRoles, parent_role_count: parentRoleCount }] };
      if (sql.includes("current_database() AS database_name")) return { rows: [{
        database_name: "bros_intelligence_dev", rls_enabled: true, rls_forced: true,
        can_read_memberships: true, can_insert_memberships: false,
        can_update_memberships: false, can_delete_memberships: false,
        can_truncate_memberships: false,
        can_reference_memberships: false, can_trigger_memberships: false,
        can_maintain_memberships: false,
        can_read_evidence: false,
        can_insert_evidence: false,
        can_update_evidence: false, can_delete_evidence: false,
        can_truncate_evidence: false,
        can_reference_evidence: false, can_trigger_evidence: false,
        can_maintain_evidence: false,
        can_create_schema_objects: false,
        can_create_database_objects: false, no_definer_exec: true, no_external_definer_exec: true, no_external_schema_create: true, no_external_table_access: true, other_bci_tables_denied: true, ...posture }] };
      if (sql.includes("set_config")) return { rows: [{ principal_scope: params[0] }] };
      return { rows };
    };
    try { const value = await fn(query); calls.push({ sql: "COMMIT", params: [] }); return value; }
    catch (error) { calls.push({ sql: "ROLLBACK", params: [] }); throw error; }
  };
  return { calls, lookup: createNeonDevMembershipLookup(transaction) };
}

test("verified principal and product are SQL parameters inside one transaction", async () => {
  const { calls, lookup } = fixture();
  assert.deepEqual(await lookup(USER, "content"), [{ principalId: USER, tenantId: TENANT, product: "content", active: true }]);
  assert.equal(calls[0].sql, "BEGIN"); assert.equal(calls.at(-1).sql, "COMMIT");
  assert.deepEqual(calls[3].params, [USER]);
  assert.deepEqual(calls[4].params, [USER, "content"]);
  assert.match(calls[4].sql, /principal_id = \$1::uuid AND product = \$2::text/);
  assert.equal(calls[4].sql.includes(USER), false);
});

test("empty authoritative membership fails closed for downstream private reader", async () => {
  assert.deepEqual(await fixture({ rows: [] }).lookup(USER, "content"), []);
});

test("rejects caller-controlled or malformed principal and product before database access", async () => {
  for (const [principal, product] of [["attacker", "content"], [USER + "x", "content"],
    [USER, "sell"], [USER, "content'; DROP TABLE x; --"]]) {
    const { calls, lookup } = fixture();
    await assert.rejects(lookup(principal, product), NeonMembershipAccessDenied);
    assert.equal(calls.length, 0);
  }
});

test("rejects admin session SET ROLE impersonation and any privileged role", async () => {
  for (const options of [{ role: "BROS", bypass: true },
    { role: "bci_dev_membership_reader", sessionRole: "BROS" },
    { role: "bci_dev_membership_reader", bypass: true },
    { role: "bci_dev_membership_reader", superuser: true },
    { role: "bci_dev_membership_reader", canLogin: false }]) {
    const { calls, lookup } = fixture(options);
    await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
    assert.equal(calls.some(c => c.sql.includes("set_config")), false);
    assert.equal(calls.at(-1).sql, "ROLLBACK");
  }
});

test("restricted membership LOGIN rejects elevated attributes and inherited parent roles", async () => {
  for (const elevated of [
    { canCreateDatabase: true }, { canManageRoles: true }, { canReplicate: true },
    { inheritsRoles: true }, { parentRoleCount: 1 }, { parentRoleCount: null },
  ]) {
    const { calls, lookup } = fixture(elevated);
    await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
    assert.equal(calls.some(c => c.sql.includes("set_config")), false);
    assert.equal(calls.at(-1).sql, "ROLLBACK");
  }
});

test("rejects wrong database, RLS drift and excessive membership privileges", async () => {
  for (const posture of [{ database_name: "neondb" }, { rls_enabled: false },
    { rls_forced: false }, { can_read_memberships: false },
    { can_insert_memberships: true },
    { can_update_memberships: true }, { can_delete_memberships: true }, { can_truncate_memberships: true },
    { can_reference_memberships: true }, { can_trigger_memberships: true },
    { can_maintain_memberships: true }, { can_maintain_memberships: null },
    { can_reference_memberships: null }, { can_trigger_memberships: null },
    { can_read_evidence: true }, { can_insert_evidence: true },
    { can_update_evidence: true }, { can_delete_evidence: true }, { can_truncate_evidence: true },
    { can_reference_evidence: true }, { can_trigger_evidence: true },
    { can_maintain_evidence: true }, { can_maintain_evidence: null },
    { can_reference_evidence: null }, { can_trigger_evidence: null },
    { can_create_schema_objects: true }, { can_create_database_objects: true },
    { other_bci_tables_denied: false }, { other_bci_tables_denied: null },
    { no_definer_exec: false }, { no_definer_exec: null },
    { no_external_schema_create: false }, { no_external_schema_create: null },
    { no_external_table_access: false }, { no_external_table_access: null }]) {
    const { calls, lookup } = fixture({ posture });
    await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
    assert.equal(calls.some(c => c.sql.includes("set_config")), false);
  }
});

test("rejects cross-principal, cross-product, inactive, revoked and invalid tenant rows", async () => {
  for (const change of [{ principalId: OTHER }, { product: "demand" },
    { active: false }, { revokedAt: "2026-10-25T00:00:00Z" },
    { tenantId: "attacker" }]) {
    const { lookup } = fixture({ rows: [{ ...membership, ...change }] });
    await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
  }
});

test("rejects ambiguous multi-tenant membership rather than choosing a tenant", async () => {
  const { lookup } = fixture({ rows: [membership, { ...membership, tenantId: OTHER }] });
  await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
});

test("database errors roll back and never return stale memberships", async () => {
  const { calls, lookup } = fixture({ errorAt: 2 });
  await assert.rejects(lookup(USER, "content"), /DB offline/);
  assert.equal(calls.at(-1).sql, "ROLLBACK");
  assert.equal(calls.some(c => c.sql.includes("FROM bci_dev.tenant_memberships")), false);
});


test("membership reader checks REFERENCES and TRIGGER on both tables before setting principal", async () => {
  const { calls, lookup } = fixture({ posture: { can_trigger_memberships: true } });
  await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
  const posture = calls.find(c => c.sql?.includes("current_database() AS database_name"));
  assert.ok(posture);
  for (const table of ["tenant_memberships", "evidence"]) {
    for (const privilege of ["REFERENCES", "TRIGGER"]) {
      assert.ok(posture.sql.includes(`'bci_dev.${table}', '${privilege}'`));
    }
  }
  assert.equal(calls.some(c => c.sql?.includes("set_config")), false);
  assert.equal(calls.at(-1).sql, "ROLLBACK");
});


test("membership reader fails closed on executable BCI SECURITY DEFINER privilege drift", async () => {
  const { calls, lookup } = fixture({ posture: { no_definer_exec: false } });
  await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
  const posture = calls.find(c => c.sql?.includes("current_database() AS database_name"));
  assert.match(posture.sql, /pg_proc/);
  assert.match(posture.sql, /prosecdef/);
  assert.match(posture.sql, /has_function_privilege\(current_user, proc\.oid, 'EXECUTE'\)/);
  assert.equal(calls.some(c => c.sql?.includes("set_config")), false);
  assert.equal(calls.at(-1).sql, "ROLLBACK");
});


test("restricted LOGIN rejects accidental non-BCI table grants before setting scope", async () => {
  const { calls, lookup } = fixture({ posture: { no_external_table_access: false } });
  await assert.rejects(lookup(USER, "content"), /access denied/i);
  const posture = calls.find(c => c.sql?.includes("no_external_table_access"));
  assert.ok(posture);
  assert.match(posture.sql, /outside_ns\.nspname <> 'bci_dev'/);
  assert.match(posture.sql, /has_table_privilege\(current_user, outside_table\.oid/);
  assert.equal(calls.some(c => c.sql?.includes("set_config")), false);
});


test("membership restricted LOGIN rejects external SECURITY DEFINER execute drift before principal scope", async () => {
  for (const flag of [false, null]) {
    const { calls, lookup } = fixture({ posture: { no_external_definer_exec: flag } });
    await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
    const posture = calls.find(c => c.sql?.includes("no_external_definer_exec"));
    assert.ok(posture);
    assert.match(posture.sql, /external_ns\.nspname <> 'bci_dev'/);
    assert.match(posture.sql, /external_proc\.prosecdef/);
    assert.match(posture.sql, /has_function_privilege\(current_user, external_proc\.oid, 'EXECUTE'\)/);
    assert.equal(calls.some(c => c.sql?.includes("set_config")), false);
    assert.equal(calls.at(-1).sql, "ROLLBACK");
  }
});


test("membership restricted LOGIN rejects external schema CREATE privilege drift before principal scope", async () => {
  for (const flag of [false, null]) {
    const { calls, lookup } = fixture({ posture: { no_external_schema_create: flag } });
    await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
    const posture = calls.find(c => c.sql?.includes("no_external_schema_create"));
    assert.ok(posture);
    assert.match(posture.sql, /external_schema\.nspname <> 'bci_dev'/);
    assert.match(posture.sql, /has_schema_privilege\(current_user, external_schema\.oid, 'CREATE'\)/);
    assert.equal(calls.some(c => c.sql?.includes("set_config")), false);
    assert.equal(calls.at(-1).sql, "ROLLBACK");
  }
});

test("membership LOGIN enforces PostgreSQL MAINTAIN privilege separation before principal scope", async () => {
  const { calls, lookup } = fixture({ posture: { can_maintain_memberships: true } });
  await assert.rejects(lookup(USER, "content"), NeonMembershipAccessDenied);
  const sql = calls.find(c => c.sql?.includes("current_database() AS database_name"))?.sql;
  assert.ok(sql);
  for (const [table, alias] of [["tenant_memberships", "memberships"], ["evidence", "evidence"]]) {
    assert.ok(sql.includes(`has_table_privilege(current_user, 'bci_dev.${table}', 'MAINTAIN') AS can_maintain_${alias}`));
  }
  assert.match(sql, /TRUNCATE, REFERENCES, TRIGGER, MAINTAIN/);
  assert.equal(calls.some(c => c.sql?.includes("set_config")), false);
  assert.equal(calls.at(-1).sql, "ROLLBACK");
});
