import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessOsDevReadOnlyTransaction } from "../lib/bci/assistant-evidence-neon-dev-readonly-transaction.ts";

function fixture() {
  const trace = [], released = [];
  let open = false;
  const pool = { async connect() {
    return {
      async query(sql, params = []) {
        trace.push({ sql, params });
        if (sql.startsWith("BEGIN TRANSACTION")) { assert.equal(open, false); open = true; }
        else if (sql === "ROLLBACK") { assert.equal(open, true); open = false; }
        else assert.equal(open, true);
        return { rows: [] };
      },
      release(error) { assert.equal(open, false); released.push(error); },
    };
  }};
  return { transaction: createBusinessOsDevReadOnlyTransaction(pool), trace, released };
}
const readSql = "SELECT current_database()";

test("fixed four-statement restricted reader contract remains inside budget", async () => {
  const f = fixture();
  await f.transaction(async query => {
    for (let i = 0; i < 4; i++) await query(readSql, []);
  });
  assert.equal(f.trace.filter(x => x.sql === readSql).length, 4);
  assert.equal(f.trace.at(-1).sql, "ROLLBACK");
  assert.deepEqual(f.released, [undefined]);
});

test("ninth reader query is denied before SQL dispatch and rolls back", async () => {
  const f = fixture();
  await assert.rejects(() => f.transaction(async query => {
    for (let i = 0; i < 9; i++) await query(readSql, []);
  }), error => error.name === "DevReadTransactionUnavailable");
  assert.equal(f.trace.filter(x => x.sql === readSql).length, 8);
  assert.equal(f.trace.at(-1).sql, "ROLLBACK");
  assert.equal(f.released.length, 1);
});

test("concurrent query attempts cannot exceed transaction budget", async () => {
  const f = fixture();
  await assert.rejects(() => f.transaction(async query => {
    const results = await Promise.allSettled(Array.from({ length: 20 },
      () => query(readSql, [])));
    assert.equal(results.filter(x => x.status === "rejected").length, 12);
  }), error => error.name === "DevReadTransactionUnavailable");
  assert.equal(f.trace.filter(x => x.sql === readSql).length, 8);
  assert.equal(f.trace.at(-1).sql, "ROLLBACK");
});

test("oversized SQL or too many bound values are rejected before dispatch", async () => {
  for (const [sql, params] of [
    ["SELECT '" + "x".repeat(4097) + "'", []],
    [readSql, [1, 2, 3, 4]],
    ["SELECT 'é' || '" + "a".repeat(4090) + "'", []],
  ]) {
    const f = fixture();
    await assert.rejects(() => f.transaction(async query => query(sql, params)),
      error => error.name === "DevReadTransactionUnavailable");
    assert.equal(f.trace.some(x => x.sql === sql), false);
    assert.equal(f.trace.at(-1).sql, "ROLLBACK");
  }
});
