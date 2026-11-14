import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessOsDevReadOnlyTransaction, DevReadTransactionUnavailable } from "../lib/bci/assistant-evidence-neon-dev-readonly-transaction.ts";

for (const malformed of [undefined, null, {}, { rows: null }, { rows: {} }, { rows: "not-an-array" }]) {
  test("malformed restricted SQL result fails closed even when callback catches it: " + String(malformed?.rows), async () => {
    const calls = [];
    const releases = [];
    const pool = { async connect() { return {
      async query(sql) {
        calls.push(sql);
        if (sql === "SELECT malformed") return malformed;
        return { rows: [] };
      },
      release(error) { releases.push(error); },
    }; } };
    const transaction = createBusinessOsDevReadOnlyTransaction(pool);
    await assert.rejects(() => transaction(async query => {
      try { await query("SELECT malformed", []); } catch { /* application caught error */ }
      return "must-not-succeed";
    }), error => error instanceof DevReadTransactionUnavailable);
    assert.equal(calls.at(-1), "ROLLBACK");
    assert.equal(releases.length, 1);
  });
}

test("valid empty rows remain distinguishable from malformed driver responses", async () => {
  const transaction = createBusinessOsDevReadOnlyTransaction({
    async connect() { return {
      async query() { return { rows: [] }; },
      release() {},
    }; },
  });
  const result = await transaction(async query => query("SELECT empty", []));
  assert.deepEqual(result.rows, []);
});
