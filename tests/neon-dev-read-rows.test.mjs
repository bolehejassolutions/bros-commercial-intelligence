import test from "node:test";
import assert from "node:assert/strict";
import { createNeonDevReadRows } from "../lib/bci/neon-dev-read-rows.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ROW = "44444444-4444-4444-8444-444444444444";
const scope = { tenantId: A, product: "demand", limit: 25 };

function mock({ role = "bci_dev_private_reader", bypass = false, rows = [], rejectAt = -1 } = {}) {
  const calls = [];
  const transaction = async fn => {
    calls.push({ sql: "TRANSACTION_BEGIN", params: [] });
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length - 1 === rejectAt) throw new Error("database unavailable");
      if (sql.includes("current_user AS role_name")) return { rows: [{ role_name: role, bypass_rls: bypass }] };
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
  assert.deepEqual(calls[2].params, [A, "demand"]);
  assert.match(calls[2].sql, /set_config\('bci\.tenant_id', \$1::text, true\)/);
  assert.match(calls[2].sql, /set_config\('bci\.product', \$2::text, true\)/);
  assert.deepEqual(calls[3].params, [A, "demand", 25]);
  assert.equal(calls[3].sql.includes("$1::uuid"), true);
  assert.equal(calls[3].sql.includes("$2::text"), true);
  assert.equal(calls[3].sql.includes(A), false);
  assert.equal(calls[3].sql.includes("UPDATE "), false);
  assert.equal(calls[3].sql.includes("INSERT "), false);
});

test("admin BYPASSRLS role rejected before any scoped query", async () => {
  for (const values of [{ role: "BROS", bypass: true }, { role: "bci_dev_private_reader", bypass: true }, { role: "bci_dev_runtime", bypass: false }]) {
    const { calls, read } = mock(values);
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
