import assert from "node:assert/strict";
import test from "node:test";
import { createBusinessOsDevScopedEvidenceReader, BusinessOsDevSqlDenied } from "../lib/bci/assistant-evidence-neon-dev-read.ts";
import { createDevEvidenceReadHandler } from "../lib/bci/assistant-evidence-authenticated-read.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const E = "33333333-3333-4333-8333-333333333333";
const selection = { tenantId: A, product: "demand", maxRows: 20 };
const receipt = (override = {}) => ({
  evidenceId: E, tenantId: A, product: "demand", provider: "meta_ads",
  collectedAt: "2026-11-08T04:00:00.000Z",
  observedAt: "2026-11-08T03:59:00.000Z",
  windowStart: "2026-11-07T00:00:00.000Z",
  windowEnd: "2026-11-07T23:59:59.000Z",
  completeness: "partial",
  metrics: { spend_myr: null, pixel_purchase_events: 3, unknown_metric: 99 },
  ...override,
});
function fixture({ rows = [receipt()], identity = {}, posture = {}, set = {}, failAt } = {}) {
  const calls = [];
  let rolledBack = false;
  const tx = async fn => {
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length === failAt) throw Error("SECRET_BACKEND_DRIVER_FAILURE");
      if (sql.includes("current_user AS role_name")) return { rows: [{
        role_name: "bci_dev_private_reader", session_role_name: "bci_dev_private_reader",
        bypass_rls: false, is_superuser: false, can_login: true,
        can_create_database: false, can_manage_roles: false, can_replicate: false,
        inherits_roles: false, parent_role_count: 0, ...identity,
      }] };
      if (sql.includes("current_database() AS database_name")) return { rows: [{
        database_name: "bros_intelligence_dev", read_only_mode: "on", rls_enabled: true, rls_forced: true,
        can_read_evidence: true, can_write_evidence: false,
        can_access_memberships: false, can_create_schema_objects: false,
        can_create_database_objects: false, no_definer_exec: true,
        no_external_table_access: true, ...posture,
      }] };
      if (sql.includes("set_config")) return { rows: [{
        tenant_scope: params[0], product_scope: params[1], ...set,
      }] };
      if (sql.includes("FROM bci_dev.evidence")) return { rows };
      throw Error("unexpected query");
    };
    try { return await fn(query); }
    catch (err) { rolledBack = true; throw err; }
  };
  return {
    calls, read: createBusinessOsDevScopedEvidenceReader(tx),
    get rolledBack() { return rolledBack; },
  };
}

test("restricted direct login, DB/RLS posture and bound tenant/product/limit precede data", async () => {
  const f = fixture();
  const result = await f.read(selection);
  assert.equal(result.length, 1);
  assert.equal(f.calls.length, 4);
  assert.match(f.calls[0].sql, /session_user AS session_role_name/);
  assert.deepEqual(f.calls[0].params, []);
  assert.match(f.calls[1].sql, /relforcerowsecurity/);
  assert.deepEqual(f.calls[1].params, []);
  assert.deepEqual(f.calls[2].params, [A, "demand"]);
  assert.match(f.calls[2].sql, /set_config\('bci\.tenant_id', \$1::text, true\)/);
  assert.match(f.calls[2].sql, /set_config\('bci\.product', \$2::text, true\)/);
  assert.deepEqual(f.calls[3].params, [A, "demand", 20]);
  assert.match(f.calls[3].sql, /WHERE tenant_id = \$1::uuid AND product = \$2::text/);
  assert.match(f.calls[3].sql, /LIMIT \$3::integer/);
  assert.ok(!f.calls[3].sql.includes(A));
  assert.doesNotMatch(f.calls[3].sql, /SELECT \*/);
  assert.doesNotMatch(f.calls[3].sql, /provider_record_key|source_reference|facts|unknowns/);
});

test("source provenance timestamps and unknown-vs-zero survive without source secrets", async () => {
  const f = fixture({ rows: [receipt({ metrics: { spend_myr: null, clicks: 0 } })] });
  const [result] = await f.read(selection);
  assert.equal(result.category, "evidence");
  assert.equal(result.provenance.provider, "meta_ads");
  assert.equal(result.provenance.collectedAt, "2026-11-08T04:00:00.000Z");
  assert.equal(result.provenance.observedAt, "2026-11-08T03:59:00.000Z");
  assert.equal(result.provenance.completeness, "partial");
  assert.equal(result.provenance.providerObjectId, null);
  assert.equal(result.provenance.sourceReference, "bci:dev:evidence/" + E);
  assert.deepEqual(result.metrics, { spend_myr: null, clicks: 0 });
  assert.doesNotMatch(JSON.stringify(result), /provider_record_key|source_reference|SECRET/);
});

test("invalid/forged tenant and product selectors cannot start SQL", async () => {
  for (const update of [
    { tenantId: "org-A" }, { tenantId: B + "' OR 1=1 --" },
    { tenantId: [A] }, { tenantId: { toString: () => A } },
    { product: "sell" }, { product: null }, { maxRows: 21 },
    { maxRows: 0 }, { maxRows: "20" },
  ]) {
    const f = fixture();
    await assert.rejects(f.read({ ...selection, ...update }), BusinessOsDevSqlDenied);
    assert.equal(f.calls.length, 0);
  }
});

test("admin BYPASSRLS, SET ROLE impersonation and privileged roles fail before scope", async () => {
  for (const identity of [
    { role_name: "BROS", bypass_rls: true },
    { session_role_name: "BROS" }, { bypass_rls: true },
    { is_superuser: true }, { can_login: false }, { inherits_roles: true },
    { can_manage_roles: true }, { can_create_database: true },
    { can_replicate: true }, { parent_role_count: 1 }, { parent_role_count: null },
  ]) {
    const f = fixture({ identity });
    await assert.rejects(f.read(selection), BusinessOsDevSqlDenied);
    assert.equal(f.calls.length, 1);
    assert.equal(f.rolledBack, true);
  }
});

test("wrong database, RLS or privilege drift rejects before any tenant GUC", async () => {
  for (const posture of [
    { database_name: "neondb" }, { read_only_mode: "off" }, { rls_enabled: false }, { rls_forced: false },
    { can_read_evidence: false }, { can_write_evidence: true },
    { can_access_memberships: true }, { can_create_schema_objects: true },
    { can_create_database_objects: true }, { no_definer_exec: false },
    { no_external_table_access: false }, { no_definer_exec: null },
  ]) {
    const f = fixture({ posture });
    await assert.rejects(f.read(selection), BusinessOsDevSqlDenied);
    assert.equal(f.calls.length, 2);
    assert.equal(f.rolledBack, true);
  }
});

test("scope GUC readback mismatch blocks the query", async () => {
  for (const set of [{ tenant_scope: B }, { product_scope: "content" },
    { tenant_scope: null }]) {
    const f = fixture({ set });
    await assert.rejects(f.read(selection), BusinessOsDevSqlDenied);
    assert.equal(f.calls.length, 3);
  }
});

test("cross-tenant, cross-product and invalid provider fail the whole read", async () => {
  for (const row of [
    receipt({ tenantId: B }), receipt({ product: "content" }),
    receipt({ provider: "other" }), receipt({ provider: "hitpay" }),
    null,
  ]) {
    const f = fixture({ rows: [receipt(), row] });
    await assert.rejects(f.read(selection), BusinessOsDevSqlDenied);
    assert.equal(f.rolledBack, true);
  }
});

test("malformed timestamps/metrics or overlapping time windows never become clean evidence", async () => {
  for (const row of [
    receipt({ collectedAt: "yesterday" }),
    receipt({ observedAt: null }),
    receipt({ windowStart: "2026-11-09T00:00:00.000Z" }),
    receipt({ metrics: { clicks: -1 } }),
    receipt({ metrics: { clicks: NaN } }),
    receipt({ metrics: { "Invalid Key": 1 } }),
    receipt({ metrics: [] }),
    receipt({ metrics: Object.fromEntries(Array.from({ length: 101 }, (_, i) => ["m" + i, i])) }),
  ]) {
    const f = fixture({ rows: [row] });
    await assert.rejects(f.read(selection), BusinessOsDevSqlDenied);
  }
});

test("duplicate evidence ID, oversized responses and malformed result objects are denied", async () => {
  for (const rows of [
    [receipt(), receipt()], Array.from({ length: 21 }, (_, i) =>
      receipt({ evidenceId: "44444444-4444-4444-8444-" + String(i).padStart(12, "0") })),
    null, { not: "a result" },
  ]) {
    const f = fixture({ rows });
    await assert.rejects(f.read(selection), BusinessOsDevSqlDenied);
  }
});

test("SQL driver failure is propagated to the fail-closed HTTP boundary; never fallback", async () => {
  const f = fixture({ failAt: 3 });
  await assert.rejects(f.read(selection), BusinessOsDevSqlDenied);
  assert.equal(f.calls.length, 3);
  assert.equal(f.rolledBack, true);
  assert.equal(f.calls.some(c => c.sql.includes("FROM bci_dev.evidence")), false);
});

test("DEV HTTP handler composes verified subject, grant, scoped SQL and privacy projection", async () => {
  const f = fixture({ rows: [receipt({ metrics: { spend_myr: null, clicks: 0, paid_orders: null } })] });
  const log = [];
  const handler = createDevEvidenceReadHandler({
    now: () => Date.parse("2026-11-08T05:00:00Z"),
    verifyBearerToken: async () => {
      log.push("verified"); return { subjectId: "user-1", expiresAt: "2026-11-08T05:10:00Z" };
    },
    hasEvidenceReadGrant: async (_user, requested) => {
      log.push("grant");
      return requested.tenantId === A && requested.product === "demand";
    },
    listScopedReceipts: async requested => {
      log.push("sql"); return f.read(requested);
    },
  });
  const url = "https://dev.example/internal/dev/bros-business-os/evidence?tenant_id=" + A + "&product=demand";
  const response = await handler(new Request(url, { headers: { authorization: "Bearer synthetic" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(log, ["verified", "grant", "sql"]);
  const body = await response.json();
  assert.equal(body.access, "read_only");
  assert.equal(body.result, "observed_rows");
  assert.equal(body.receipts[0].metrics.spend_myr, null);
  assert.equal(body.receipts[0].metrics.clicks, 0);
  assert.equal(body.receipts[0].metrics.paid_orders, null);
  assert.equal(body.receipts[0].sourceReference, "bci:dev:evidence/" + E);
  assert.ok(!("unknown_metric" in body.receipts[0].metrics));
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("HTTP denial blocks repository entirely; DB failure returns generic 503", async () => {
  const f = fixture();
  const handler = createDevEvidenceReadHandler({
    now: () => Date.parse("2026-11-08T05:00:00Z"),
    verifyBearerToken: async () => ({ subjectId: "user-1", expiresAt: "2026-11-08T05:10:00Z" }),
    hasEvidenceReadGrant: async () => false,
    listScopedReceipts: f.read,
  });
  const url = "https://dev.example/internal/dev/bros-business-os/evidence?tenant_id=" + A + "&product=demand";
  assert.equal((await handler(new Request(url, { headers: { authorization: "Bearer synthetic" } }))).status, 403);
  assert.equal(f.calls.length, 0);
  const bad = fixture({ posture: { can_write_evidence: true } });
  const fail = createDevEvidenceReadHandler({
    now: () => Date.parse("2026-11-08T05:00:00Z"),
    verifyBearerToken: async () => ({ subjectId: "user-1", expiresAt: "2026-11-08T05:10:00Z" }),
    hasEvidenceReadGrant: async () => true,
    listScopedReceipts: bad.read,
  });
  const res = await fail(new Request(url, { headers: { authorization: "Bearer synthetic" } }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "read_unavailable" });
});
