import test from "node:test";
import assert from "node:assert/strict";
import { createNeonDevReadRows } from "../lib/bci/neon-dev-read-rows.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ROW = "44444444-4444-4444-8444-444444444444";
const scope = { tenantId: A, product: "demand", limit: 25 };

function mock({
  role = "bci_dev_private_reader",
  sessionRole = "bci_dev_private_reader",
  bypass = false,
  superuser = false,
  canLogin = true,
  canCreateDatabase = false,
  canManageRoles = false,
  canReplicate = false,
  inheritsRoles = false,
  parentRoleCount = 0,
  rows = [],
  rejectAt = -1,
  safety = {},
} = {}) {
  const calls = [];
  const transaction = async fn => {
    calls.push({ sql: "TRANSACTION_BEGIN", params: [] });
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length - 1 === rejectAt) throw new Error("database unavailable");
      if (sql.includes("current_user AS role_name")) return { rows: [{ role_name: role, session_role_name: sessionRole, bypass_rls: bypass, is_superuser: superuser, can_login: canLogin, can_create_database: canCreateDatabase,
        can_manage_roles: canManageRoles, can_replicate: canReplicate,
        inherits_roles: inheritsRoles, parent_role_count: parentRoleCount }] };
      if (sql.includes("current_database() AS database_name")) return { rows: [{
        database_name: "bros_intelligence_dev",
        rls_enabled: true, rls_forced: true, can_read_evidence: true,
        can_insert_evidence: false, can_update_evidence: false,
        can_delete_evidence: false, can_truncate_evidence: false,
        can_reference_evidence: false, can_trigger_evidence: false,
        can_read_memberships: false, can_insert_memberships: false, can_update_memberships: false,
        can_delete_memberships: false, can_truncate_memberships: false,
        can_reference_memberships: false, can_trigger_memberships: false,
        lineage_tables_readonly: true,
        can_create_schema_objects: false, can_create_database_objects: false, no_definer_exec: true, no_external_table_access: true,
        ...safety,
      }] };
      if (sql.includes("set_config")) return { rows: [{ scope: params[0] }] };
      return { rows };
    };
    try {
      const value = await fn(query);
      calls.push({ sql: "TRANSACTION_COMMIT", params: [] });
      return value;
    } catch (e) {
      calls.push({ sql: "TRANSACTION_ROLLBACK", params: [] });
      throw e;
    }
  };
  return { calls, read: createNeonDevReadRows(transaction) };
}

test("bound parameters and same transaction; no interpolated tenant or product", async () => {
  const fixture = { id: ROW, tenantId: A, product: "demand", provider: "manual", providerRecordKey: "synthetic", metrics: { purchases: null, clicks: 0 } };
  const { calls, read } = mock({ rows: [fixture] });
  const data = await read(scope);
  assert.deepEqual(data, [fixture]);
  assert.equal(calls[0].sql, "TRANSACTION_BEGIN");
  assert.equal(calls.at(-1).sql, "TRANSACTION_COMMIT");
  assert.match(calls[2].sql, /current_database\(\) AS database_name/);
  assert.deepEqual(calls[3].params, [A, "demand"]);
  assert.match(calls[3].sql, /set_config\('bci\.tenant_id', \$1::text, true\)/);
  assert.match(calls[3].sql, /set_config\('bci\.product', \$2::text, true\)/);
  assert.deepEqual(calls[4].params, [A, "demand", 25]);
  assert.equal(calls[4].sql.includes("$1::uuid"), true);
  assert.equal(calls[4].sql.includes("$2::text"), true);
  assert.equal(calls[4].sql.includes(A), false);
  assert.equal(calls[4].sql.includes("UPDATE "), false);
  assert.equal(calls[4].sql.includes("INSERT "), false);
});

test("admin BYPASSRLS role rejected before any scoped query", async () => {
  for (const values of [{ role: "BROS", bypass: true }, { role: "bci_dev_private_reader", bypass: true }, { role: "bci_dev_runtime", bypass: false }]) {
    const { calls, read } = mock(values);
    await assert.rejects(read(scope), /access denied/i);
    assert.equal(calls.some(x => x.sql.includes("set_config")), false);
    assert.equal(calls.at(-1).sql, "TRANSACTION_ROLLBACK");
  }
});

test("admin SET ROLE impersonation, superuser and NOLOGIN session fail before scoped SQL", async () => {
  for (const values of [
    { role: "bci_dev_private_reader", sessionRole: "BROS" },
    { role: "bci_dev_private_reader", sessionRole: "bros_intelligence_dev_owner" },
    { role: "bci_dev_private_reader", superuser: true },
    { role: "bci_dev_private_reader", canLogin: false },
    { role: "bci_dev_private_reader", sessionRole: null },
  ]) {
    const { calls, read } = mock(values);
    await assert.rejects(read(scope), /access denied/i);
    assert.equal(calls.some(x => x.sql.includes("set_config")), false);
    assert.equal(calls.at(-1).sql, "TRANSACTION_ROLLBACK");
  }
});

test("restricted evidence LOGIN rejects elevated attributes and inherited parent roles", async () => {
  for (const elevated of [
    { canCreateDatabase: true }, { canManageRoles: true }, { canReplicate: true },
    { inheritsRoles: true }, { parentRoleCount: 1 }, { parentRoleCount: null },
  ]) {
    const { calls, read } = mock(elevated);
    await assert.rejects(read(scope), /access denied/i);
    assert.equal(calls.some(x => x.sql.includes("set_config")), false);
    assert.equal(calls.at(-1).sql, "TRANSACTION_ROLLBACK");
  }
});

test("bad tenant UUID, product and limit are rejected without SQL", async () => {
  for (const change of [
    { tenantId: "b'; DROP TABLE bci_dev.evidence; --" }, { tenantId: B + "x" },
    { product: "sell" }, { limit: 0 }, { limit: 100 }, { limit: 1.5 },
  ]) {
    const { calls, read } = mock();
    await assert.rejects(read({ ...scope, ...change }), /access denied/i);
    assert.equal(calls.length, 0);
  }
});

test("returned cross-tenant/cross-product evidence rejected, not filtered silently", async () => {
  for (const row of [
    { id: ROW, tenantId: B, product: "demand", provider: "manual", providerRecordKey: "b", metrics: {} },
    { id: ROW, tenantId: A, product: "content", provider: "manual", providerRecordKey: "content", metrics: {} },
  ]) {
    const { read, calls } = mock({ rows: [row] });
    await assert.rejects(read(scope), /access denied/i);
    assert.equal(calls.at(-1).sql, "TRANSACTION_ROLLBACK");
  }
});

test("unknown metrics do not silently become zero; malformed metrics rejected", async () => {
  for (const metrics of [{ purchases: "1" }, { clicks: Infinity }, null, []]) {
    const { read } = mock({ rows: [{ id: ROW, tenantId: A, product: "demand", provider: "manual", providerRecordKey: "x", metrics }] });
    await assert.rejects(read(scope), /access denied/i);
  }
  const { read } = mock({ rows: [{ id: ROW, tenantId: A, product: "demand", provider: "manual", providerRecordKey: "x", metrics: { purchases: null, clicks: 0 } }] });
  assert.deepEqual((await read(scope))[0].metrics, { purchases: null, clicks: 0 });
});

test("query errors cause rollback and never fall back to an unscoped read", async () => {
  const { read, calls } = mock({ rejectAt: 2 });
  await assert.rejects(read(scope), /database unavailable/);
  assert.equal(calls.at(-1).sql, "TRANSACTION_ROLLBACK");
  assert.equal(calls.some(x => x.sql.includes("FROM bci_dev.evidence")), false);
});

test("untrusted result larger than requested page fails closed", async () => {
  const row = { id: ROW, tenantId: A, product: "demand", provider: "manual", providerRecordKey: "x", metrics: {} };
  const { read } = mock({ rows: [row, row] });
  await assert.rejects(read({ ...scope, limit: 1 }), /access denied/i);
});

test("wrong database, missing RLS and privilege drift fail before scoped SQL", async () => {
  for (const safety of [
    { database_name: "neondb" },
    { rls_enabled: false },
    { rls_forced: false },
    { can_read_evidence: false },
    { can_insert_evidence: true },
    { can_update_evidence: true }, { can_delete_evidence: true }, { can_truncate_evidence: true },
    { can_reference_evidence: true }, { can_trigger_evidence: true },
    { can_read_memberships: true }, { can_insert_memberships: true },
    { can_update_memberships: true }, { can_delete_memberships: true }, { can_truncate_memberships: true },
    { can_reference_memberships: true }, { can_trigger_memberships: true },
    { lineage_tables_readonly: false }, { lineage_tables_readonly: null },
    { can_create_schema_objects: true },
    { can_create_database_objects: true },
    { no_definer_exec: false }, { no_definer_exec: null },
    { no_external_table_access: false }, { no_external_table_access: null },
  ]) {
    const { calls, read } = mock({ safety });
    await assert.rejects(read(scope), /access denied/i);
    assert.equal(calls.some(x => x.sql.includes("set_config")), false);
    assert.equal(calls.at(-1).sql, "TRANSACTION_ROLLBACK");
  }
});


test("malformed provider metric keys and unbounded JSONB maps fail closed", async () => {
  const base = { id: ROW, tenantId: A, product: "demand",
    provider: "manual", providerRecordKey: "x" };
  for (const metrics of [
    JSON.parse('{"__proto__": null}'),
    { "bad key": 1 },
    { "Uppercase": 1 },
    Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`metric_${i}`, i])),
  ]) {
    const { read, calls } = mock({ rows: [{ ...base, metrics }] });
    await assert.rejects(read(scope), /access denied/i);
    assert.equal(calls.at(-1).sql, "TRANSACTION_ROLLBACK");
  }
});


test("evidence reader requires RLS-forced read-only access to all three shared lineage tables", async () => {
  const { calls, read } = mock({ safety: { lineage_tables_readonly: false } });
  await assert.rejects(read(scope), /access denied/i);
  const posture = calls.find(x => x.sql.includes("lineage_tables_readonly"));
  assert.ok(posture, "the real posture SQL must verify lineage tables");
  assert.match(posture.sql, /COUNT\(\*\) = 3/);
  assert.match(posture.sql, /extra\.relforcerowsecurity/);
  assert.match(posture.sql, /'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'/);
  assert.equal(calls.some(x => x.sql.includes("set_config")), false);
  assert.equal(calls.at(-1).sql, "TRANSACTION_ROLLBACK");
});


test("evidence reader fails closed on executable BCI SECURITY DEFINER privilege drift", async () => {
  const { calls, read } = mock({ safety: { no_definer_exec: false } });
  await assert.rejects(read(scope), /access denied/i);
  const posture = calls.find(c => c.sql?.includes("current_database() AS database_name"));
  assert.match(posture.sql, /pg_proc/);
  assert.match(posture.sql, /prosecdef/);
  assert.match(posture.sql, /has_function_privilege\(current_user, proc\.oid, 'EXECUTE'\)/);
  assert.equal(calls.some(c => c.sql?.includes("set_config")), false);
  assert.equal(calls.at(-1).sql, "TRANSACTION_ROLLBACK");
});


test("restricted LOGIN rejects accidental non-BCI table grants before setting scope", async () => {
  const { calls, read } = mock({ safety: { no_external_table_access: false } });
  await assert.rejects(read(scope), /access denied/i);
  const posture = calls.find(c => c.sql?.includes("no_external_table_access"));
  assert.ok(posture);
  assert.match(posture.sql, /outside_ns\.nspname <> 'bci_dev'/);
  assert.match(posture.sql, /has_table_privilege\(current_user, outside_table\.oid/);
  assert.equal(calls.some(c => c.sql?.includes("set_config")), false);
});
