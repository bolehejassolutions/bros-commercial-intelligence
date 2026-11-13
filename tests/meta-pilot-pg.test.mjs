import test from "node:test";
import assert from "node:assert/strict";
import { createPgPilotTransaction } from "../lib/demand/meta-pilot-pg.ts";
import { verifyPilotLedger } from "../lib/demand/meta-pilot-ledger-verification.ts";

function pool(fail = "") {
  const calls = [], releases = [];
  return { calls, releases, connect: async () => ({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql === fail) throw Error("postgres://private:secret@invalid/driver-detail");
    return { rows: [{ value: 7 }] };
  }, release: destroy => releases.push(destroy) }) };
}
test("pilot transaction owns its client, uses current snapshots and closes its executor after commit", async () => {
  const db = pool(); let leakedQuery;
  const result = await createPgPilotTransaction(db)(async query => {
    leakedQuery = query; return query("SELECT $1", ["bounded"]);
  });
  assert.equal(result.rows[0].value, 7);
  assert.equal(db.calls[0].sql, "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
  assert.equal(db.calls.at(-1).sql, "COMMIT"); assert.deepEqual(db.releases, [false]);
  const count = db.calls.length;
  assert.throws(() => leakedQuery("SELECT 1", []), /TRANSACTION_CLOSED/);
  assert.equal(db.calls.length, count);
});
test("callback and ambiguous COMMIT failures roll back, destroy and redact the connection error", async () => {
  for (const failedCommit of [false, true]) {
    const db = pool(failedCommit ? "COMMIT" : "");
    await assert.rejects(createPgPilotTransaction(db)(async () => {
      if (!failedCommit) throw Error("provider-secret-value"); return 1;
    }), e => e.message === "PILOT_TRANSACTION_UNAVAILABLE");
    assert.equal(db.calls.at(-1).sql, "ROLLBACK"); assert.deepEqual(db.releases, [true]);
  }
});
test("failed physical login never enters the callback or exposes a driver credential", async () => {
  let callbacks = 0;
  const db = { connect: async () => { throw Error("postgres://credential-bearing"); } };
  await assert.rejects(createPgPilotTransaction(db)(async () => { callbacks++; }), /TRANSACTION_UNAVAILABLE/);
  assert.equal(callbacks, 0);
});
test("real ledger verifier rejects a fake admin posture before creating any probe row", async () => {
  const db = pool();
  await assert.rejects(verifyPilotLedger(db, {
    tenantId: "11111111-1111-4111-8111-111111111111", principalId: "22222222-2222-4222-8222-222222222222",
  }), e => e.message === "PILOT_LEDGER_VERIFICATION_FAILED" && e.phase === "snapshot");
  assert.ok(db.calls.every(c => !c.sql.startsWith("INSERT")));
});
