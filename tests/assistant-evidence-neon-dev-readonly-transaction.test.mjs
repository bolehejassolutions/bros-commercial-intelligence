import test from "node:test";
import assert from "node:assert/strict";
import {
  createBusinessOsDevReadOnlyTransaction,
  DevReadTransactionUnavailable,
} from "../lib/bci/assistant-evidence-neon-dev-readonly-transaction.ts";

function fixture({ failAt = "", rollbackFails = false } = {}) {
  const calls = [];
  const releases = [];
  let connections = 0;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes(failAt) && failAt) throw Error("PRIVATE_DB_CREDENTIAL");
      if (sql === "ROLLBACK" && rollbackFails) throw Error("PRIVATE_DB_CREDENTIAL");
      return { rows: [{ ok: true }] };
    },
    release(error) { releases.push(error); },
  };
  const pool = { async connect() { connections++; return client; } };
  return { transaction: createBusinessOsDevReadOnlyTransaction(pool),
    calls, releases, connections: () => connections };
}
test("pinned read-only transaction executes one client, local timeouts, rollback and release", async () => {
  const f = fixture();
  const result = await f.transaction(async query => {
    await query("SELECT $1::text", ["synthetic"]);
    return "synthetic-result";
  });
  assert.equal(result, "synthetic-result");
  assert.equal(f.connections(), 1);
  assert.deepEqual(f.calls.map(x => x.sql), [
    "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY",
    "SET LOCAL statement_timeout = '5000ms'",
    "SET LOCAL lock_timeout = '1000ms'",
    "SET LOCAL idle_in_transaction_session_timeout = '7000ms'",
    "SELECT $1::text", "ROLLBACK",
  ]);
  assert.deepEqual(f.calls[4].params, ["synthetic"]);
  assert.deepEqual(f.releases, [undefined]);
});
test("reader SQL failure rolls back, discards secrets and releases connection", async () => {
  const f = fixture({ failAt: "SELECT" });
  await assert.rejects(() => f.transaction(q => q("SELECT $1", [123])),
    e => e instanceof DevReadTransactionUnavailable && !e.message.includes("PRIVATE"));
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
  assert.equal(f.releases.length, 1);
  assert.equal(f.releases[0], undefined);
});
test("callback exception rolls back and hides exception", async () => {
  const f = fixture();
  await assert.rejects(() => f.transaction(async () => {
    throw Error("PRIVATE_AUTH_TOKEN");
  }), e => e instanceof DevReadTransactionUnavailable && !e.message.includes("PRIVATE"));
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
  assert.equal(f.releases.length, 1);
});
test("failed transaction setup denies callback and discards client", async () => {
  const f = fixture({ failAt: "SET LOCAL statement_timeout" });
  let invoked = false;
  await assert.rejects(() => f.transaction(async () => { invoked = true; }));
  assert.equal(invoked, false);
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
  assert.equal(f.releases.length, 1);
});
test("rollback failure discards connection and denies even successful callback", async () => {
  const f = fixture({ rollbackFails: true });
  await assert.rejects(() => f.transaction(async () => "no success"), DevReadTransactionUnavailable);
  assert.equal(f.releases.length, 1);
  assert.ok(f.releases[0] instanceof Error);
  assert.ok(!f.releases[0].message.includes("PRIVATE"));
});
test("reject invalid injected pool, callback and SQL parameters before user query", async () => {
  assert.throws(() => createBusinessOsDevReadOnlyTransaction(null), DevReadTransactionUnavailable);
  const f = fixture();
  await assert.rejects(() => f.transaction(null), DevReadTransactionUnavailable);
  await assert.rejects(() => f.transaction(q => q("SELECT $1", [Infinity])),
    DevReadTransactionUnavailable);
  assert.ok(!f.calls.some(x => x.sql === "SELECT $1"));
  assert.equal(f.releases.length, 1);
});
test("connection failure does not leak private driver error", async () => {
  const transaction = createBusinessOsDevReadOnlyTransaction({
    async connect() { throw Error("PRIVATE_CONNECTION_STRING"); },
  });
  await assert.rejects(() => transaction(async () => null),
    e => e instanceof DevReadTransactionUnavailable && !e.message.includes("PRIVATE"));
});
