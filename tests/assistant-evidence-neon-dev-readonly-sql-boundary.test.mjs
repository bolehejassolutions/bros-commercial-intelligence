import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessOsDevReadOnlyTransaction } from "../lib/bci/assistant-evidence-neon-dev-readonly-transaction.ts";

function fixture() {
  const sqls = [];
  const released = [];
  const pool = { async connect() {
    return {
      async query(sql) { sqls.push(sql); return { rows: [] }; },
      release(error) { released.push(error); },
    };
  }};
  return { run: createBusinessOsDevReadOnlyTransaction(pool), sqls, released };
}

test("server-owned fixed SELECT remains permitted with transaction-local security posture", async () => {
  const f = fixture();
  await f.run(async query => {
    await query("SELECT current_database() AS database_name", []);
    await query("SELECT set_config('bci.tenant_id',$1::text,true) AS tenant_scope", ["tenant"]);
  });
  assert.deepEqual(f.sqls.slice(-3), [
    "SELECT current_database() AS database_name",
    "SELECT set_config('bci.tenant_id',$1::text,true) AS tenant_scope",
    "ROLLBACK",
  ]);
  assert.deepEqual(f.released, [undefined]);
});

test("SQL control statements and extra statements never reach the driver", async () => {
  for (const sql of [
    "SET ROLE privileged", "RESET ROLE", "SET LOCAL row_security = off",
    "BEGIN", "COMMIT", "ROLLBACK", "DISCARD ALL",
    "SELECT 1; SET ROLE privileged", "SELECT 1; ",
    "SELECT 1 -- injected comment", "SELECT /* injected */ 1",
    "SELECT 1 /* trailing */", "WITH x AS (SELECT 1) SELECT * FROM x",
    " SELECT 1",
  ]) {
    const f = fixture();
    await assert.rejects(() => f.run(async query => query(sql, [])),
      e => e.name === "DevReadTransactionUnavailable", sql);
    assert.equal(f.sqls.slice(0, -1).includes(sql), false, sql); // exclude mandatory cleanup ROLLBACK
    assert.equal(f.sqls.at(-1), "ROLLBACK");
    assert.equal(f.released.length, 1);
  }
});

test("caught rejected SQL still poisons transaction and prevents success", async () => {
  const f = fixture();
  await assert.rejects(() => f.run(async query => {
    try { await query("SET ROLE privileged", []); } catch {}
    return "should never be returned";
  }), e => e.name === "DevReadTransactionUnavailable");
  assert.equal(f.sqls.includes("SET ROLE privileged"), false);
  assert.equal(f.sqls.at(-1), "ROLLBACK");
});

test("detached rejected SQL poisons transaction even when callback returns", async () => {
  const f = fixture();
  await assert.rejects(() => f.run(async query => {
    void query("SELECT 1; DROP TABLE bci_dev.evidence", []).catch(() => {});
    return "not authorized";
  }), e => e.name === "DevReadTransactionUnavailable");
  assert.equal(f.sqls.some(x => x.includes("DROP TABLE")), false);
  assert.equal(f.sqls.at(-1), "ROLLBACK");
});
