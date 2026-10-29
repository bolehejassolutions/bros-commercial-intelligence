import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuthenticatedBciLineageWriter,
  createPgLineageWriteTransaction,
} from "../lib/bci/neon-lineage-writer.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const rootId = "44444444-4444-4444-8444-444444444444";
const childId = "55555555-5555-4555-8555-555555555555";
const evidence = {
  id: rootId, tenantId: tenant, product: "content", stage: "evidence",
  sourceSystem: "content_internal", sourceRecordKey: "draft-1",
  recordedAt: "2026-10-29T00:00:00Z", parentIds: [], verification: "unverified",
};
const signal = {
  id: childId, tenantId: tenant, product: "content", stage: "signal",
  sourceSystem: "content_internal", sourceRecordKey: "signal-1",
  recordedAt: "2026-10-29T00:01:00Z", parentIds: [rootId], verification: "unverified",
};
const role = {
  roleName: "bci_dev_lineage_writer", sessionRoleName: "bci_dev_lineage_writer",
  canLogin: true, bypassRls: false, superuser: false, canCreateRole: false,
  canCreateDb: false, canReplicate: false, inherits: false, parentRoles: 0,
};
const posture = {
  databaseName: "bros_intelligence_dev", forcedRls: true, lineageOnly: true,
  membershipDenied: true, evidenceDenied: true,
  schemaCreateDenied: true, dbCreateDenied: true,
  otherBciDenied: true, externalTablesDenied: true, definerExecDenied: true,
  allSchemaCreateDenied: true, sequenceAccessDenied: true,
};
const grant = { principalId: userId, tenantId: tenant, product: "content", active: true };
const denied = /BCI private lineage write denied/;

function harness(overrides = {}) {
  const calls = [];
  let membershipChecks = 0;
  const deps = {
    authenticate: async () => ({ userId, authenticated: true }),
    membershipsFor: async () => {
      membershipChecks++;
      return [grant];
    },
    transaction: async fn => fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('AS "roleName"')) return { rows: [role] };
      if (sql.includes('AS "forcedRls"')) return { rows: [posture] };
      if (sql.includes("AND id = ANY($3::uuid[])")) {
        if (sql.includes("FROM bci_dev.lineage_nodes")) return { rows: params[2].map(id =>
          ({ ...(id === rootId ? evidence : signal),
            recordedAt: (id === rootId ? evidence : signal).recordedAt.replace("Z", ".000Z") })) };
      }
      if (sql.includes("FROM bci_dev.lineage_edges") && sql.includes("AND child_id = ANY($3::uuid[])"))
        return { rows: params[2].includes(childId) ? [{ parentId: rootId, childId }] : [] };
      if (sql.includes("FROM bci_dev.lineage_nodes WHERE")) return { rows: [] };
      if (sql.includes("INSERT INTO bci_dev.lineage_nodes")) return { rows: [{ id: params[0] }] };
      if (sql.includes("INSERT INTO bci_dev.lineage_edges")) return { rows: [{ childId: params[3] }] };
      return { rows: [] };
    }),
    ...overrides,
  };
  return { write: createAuthenticatedBciLineageWriter(deps), calls,
    checks: () => membershipChecks };
}

test("authenticated membership scopes unverified node+edge inserts, with final recheck", async () => {
  const h = harness();
  const result = await h.write({ product: "content", records: [signal, evidence] });
  assert.deepEqual(result.insertedIds, [rootId, childId]);
  assert.deepEqual(result.replayedIds, []);
  assert.equal(h.checks(), 2);
  const scope = h.calls.find(c => c.sql.includes("set_config('bci.tenant_id'"));
  assert.deepEqual(scope.params, [tenant, "content"]);
  const inserts = h.calls.filter(c => c.sql.includes("INSERT INTO"));
  assert.equal(inserts.length, 3);
  assert.ok(inserts.every(c => !c.sql.includes("ON CONFLICT")));
  assert.ok(h.calls.some(c => c.sql === "SET CONSTRAINTS ALL IMMEDIATE"));
  assert.ok(!h.calls.some(c => c.sql.includes("UPDATE ") || c.sql.includes("DELETE ")));
});

test("writer rejects incomplete or altered transaction readback before commit", async () => {
  for (const fault of ["missing-node", "altered-node", "missing-edge"]) {
    const h = harness({ transaction: async fn => fn(async (sql, params) => {
      h.calls.push({ sql, params });
      if (sql.includes('AS "roleName"')) return { rows: [role] };
      if (sql.includes('AS "forcedRls"')) return { rows: [posture] };
      if (sql.includes("AND id = ANY($3::uuid[])")) {
        if (sql.includes("FROM bci_dev.lineage_nodes")) return { rows: fault === "missing-node" ? []
          : params[2].map(id => ({ ...(id === rootId ? evidence : signal),
            recordedAt: (id === rootId ? evidence : signal).recordedAt.replace("Z", ".000Z"),
            sourceRecordKey: fault === "altered-node" ? "tampered" :
              (id === rootId ? evidence : signal).sourceRecordKey })) };
        if (sql.includes("FROM bci_dev.lineage_edges")) return { rows: [] };
      }
      if (sql.includes("FROM bci_dev.lineage_nodes WHERE")) return { rows: [] };
      if (sql.includes("INSERT INTO bci_dev.lineage_nodes")) return { rows: [{ id: params[0] }] };
      if (sql.includes("INSERT INTO bci_dev.lineage_edges")) return { rows: [{ childId: params[3] }] };
      return { rows: [] };
    }) });
    await assert.rejects(h.write({ product: "content",
      records: fault === "missing-edge" ? [evidence, signal] : [evidence] }), denied, fault);
    assert.ok(h.calls.some(c => c.sql.includes("AND id = ANY($3::uuid[])")), fault);
  }
});

test("unverified input is mandatory and caller cannot select tenant, product or admin role", async () => {
  const h = harness();
  await assert.rejects(h.write({ product: "content", tenantId: other, records: [evidence] }), denied);
  await assert.rejects(h.write({ product: "content", role: "BROS", records: [evidence] }), denied);
  await assert.rejects(h.write({ product: "content", records: [{ ...evidence, tenantId: other }] }), denied);
  await assert.rejects(h.write({ product: "content", records: [{ ...evidence, product: "demand" }] }), denied);
  await assert.rejects(h.write({ product: "content", records: [{ ...evidence, verification: "verified" }] }), denied);
  assert.equal(h.calls.some(c => c.sql.includes("INSERT INTO")), false);
});

test("wrong session/admin SET ROLE impersonation and privilege drift fail closed", async () => {
  for (const changed of [
    { sessionRoleName: "BROS" }, { roleName: "BROS" }, { bypassRls: true },
    { canCreateRole: true }, { canReplicate: true }, { parentRoles: 1 },
  ]) {
    const h = harness({ transaction: async fn => fn(async sql =>
      sql.includes('AS "roleName"') ? { rows: [{ ...role, ...changed }] } : { rows: [posture] }) });
    await assert.rejects(h.write({ product: "content", records: [evidence] }), denied);
  }
  const h = harness({ transaction: async fn => fn(async sql =>
    sql.includes('AS "roleName"') ? { rows: [role] } :
      sql.includes('AS "forcedRls"') ? { rows: [{ ...posture, membershipDenied: false }] } : { rows: [] }) });
  await assert.rejects(h.write({ product: "content", records: [evidence] }), denied);
});

test("ambiguous membership and revoked membership before commit deny append", async () => {
  const ambiguous = harness({ membershipsFor: async () => [grant, { ...grant, tenantId: other }] });
  await assert.rejects(ambiguous.write({ product: "content", records: [evidence] }), denied);
  assert.equal(ambiguous.calls.length, 0);
  let count = 0;
  const revoked = harness({ membershipsFor: async () =>
    ++count === 1 ? [grant] : [] });
  await assert.rejects(revoked.write({ product: "content", records: [evidence] }), denied);
  assert.ok(revoked.calls.some(c => c.sql.includes("INSERT INTO")));
});

test("pinned SQL transaction commits only success, rolls back and destroys on failure", async () => {
  const statements = [];
  const releases = [];
  const pool = { connect: async () => ({
    query: async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; },
    release: destroy => releases.push(destroy),
  }) };
  const tx = createPgLineageWriteTransaction(pool);
  await tx(async query => { await query("SELECT $1::text", ["safe"]); return 42; });
  assert.equal(statements[0].sql, "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE");
  assert.ok(statements.some(x => x.sql === "SET LOCAL search_path = pg_catalog, pg_temp"));
  assert.equal(statements.at(-1).sql, "COMMIT");
  assert.deepEqual(releases, [false]);
  await assert.rejects(tx(async () => { throw new Error("sensitive password"); }), denied);
  assert.equal(statements.at(-1).sql, "ROLLBACK");
  assert.deepEqual(releases, [false, true]);
});

test("idempotent replay accepts equivalent UTC timestamps with different precision", async () => {
  const stored = { ...evidence, recordedAt: "2026-10-29T00:00:00.000Z" };
  const h = harness({ transaction: async fn => fn(async (sql, params) => {
    h.calls.push({ sql, params });
    if (sql.includes('AS "roleName"')) return { rows: [role] };
    if (sql.includes('AS "forcedRls"')) return { rows: [posture] };
    if (sql.includes("FROM bci_dev.lineage_nodes WHERE")) return { rows: [stored] };
    return { rows: [] };
  }) });
  const result = await h.write({ product: "content", records: [evidence] });
  assert.deepEqual(result.insertedIds, []);
  assert.deepEqual(result.replayedIds, [rootId]);
  assert.ok(!h.calls.some(c => c.sql.includes("INSERT INTO")));
  await assert.rejects(h.write({ product: "content", records: [
    { ...evidence, recordedAt: "2026-10-29T00:00:00+00:00" },
  ] }), denied);
});

test("writer rejects lateral privileges and SECURITY DEFINER escape paths before any append", async () => {
  for (const key of [
    "otherBciDenied", "externalTablesDenied", "definerExecDenied",
    "allSchemaCreateDenied", "sequenceAccessDenied",
  ]) {
    const h = harness({ transaction: async fn => fn(async (sql, params) => {
      h.calls.push({ sql, params });
      if (sql.includes('AS "roleName"')) return { rows: [role] };
      if (sql.includes('AS "forcedRls"')) return { rows: [{ ...posture, [key]: false }] };
      return { rows: [] };
    }) });
    await assert.rejects(h.write({ product: "content", records: [evidence] }), denied, key);
    assert.equal(h.calls.some(c => c.sql.includes("INSERT INTO")), false, key);
  }
});
