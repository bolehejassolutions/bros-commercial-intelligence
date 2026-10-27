import test from "node:test";
import assert from "node:assert/strict";
import { createPgReadOnlyTransaction, parseNeonDevConnection } from "../lib/bci/neon-readonly-transaction.ts";

function poolFixture({ failAt, failRollback = false } = {}) {
  const calls = [];
  let connections = 0;
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if ((failAt && sql.includes(failAt)) || (failRollback && sql === "ROLLBACK")) {
        throw new Error("postgres://restricted:secret-sentinel@db/bros_intelligence_dev");
      }
      return { rows: [{ value: 42 }] };
    },
    release: value => calls.push({ release: value }),
  };
  const pool = { connect: async () => { connections++; return client; } };
  return { calls, transaction: createPgReadOnlyTransaction(pool), connections: () => connections };
}

test("read-only transaction pins all queries to a single checkout and releases after commit", async () => {
  const f = poolFixture();
  const result = await f.transaction(async query => {
    await query("SELECT $1::text AS scope", ["synthetic-tenant"]);
    return (await query("SELECT 42 AS value", [])).rows[0].value;
  });
  assert.equal(result, 42);
  assert.equal(f.connections(), 1);
  assert.match(f.calls[0].sql, /^BEGIN.*READ ONLY/);
  assert.equal(f.calls[1].sql, "SET LOCAL search_path = pg_catalog, pg_temp");
  assert.ok(f.calls.findIndex(c => c.sql?.includes("statement_timeout")) > 1);
  assert.ok(f.calls.some(c => c.sql?.includes("statement_timeout")));
  assert.ok(f.calls.some(c => c.sql?.includes("idle_in_transaction_session_timeout")));
  assert.deepEqual(f.calls.find(c => c.sql?.includes("SELECT $1")).params, ["synthetic-tenant"]);
  assert.equal(f.calls.at(-2).sql, "COMMIT");
  assert.ok(Object.hasOwn(f.calls.at(-1), "release"));
});

test("read-only transaction rolls back and destroys checkout after callback failure without leaking driver detail", async () => {
  const f = poolFixture();
  await assert.rejects(f.transaction(async () => {
    throw new Error("postgres://restricted:secret-sentinel@db/bros_intelligence_dev");
  }), error => {
    assert.doesNotMatch(error.message, /secret-sentinel|postgres:|restricted/);
    return true;
  });
  assert.equal(f.calls.some(c => c.sql === "COMMIT"), false);
  assert.equal(f.calls.at(-2).sql, "ROLLBACK");
  assert.equal(f.calls.at(-1).release, true);
});

test("read-only transaction destroys failed checkout even if rollback also fails", async () => {
  const f = poolFixture({ failAt: "SELECT deliberate_failure", failRollback: true });
  await assert.rejects(f.transaction(query => query("SELECT deliberate_failure", [])),
    error => !/secret-sentinel|postgres:/.test(error.message));
  assert.equal(f.calls.at(-1).release, true);
});

test("read-only transaction cannot reuse an abandoned query callback after its checkout is released", async () => {
  const f = poolFixture();
  let escapedQuery;
  await f.transaction(async query => { escapedQuery = query; return null; });
  const count = f.calls.length;
  await assert.rejects(escapedQuery("SELECT 1", []));
  assert.equal(f.calls.length, count);
});

test("restricted connection parser rejects owner roles, wrong target and insecure TLS URL options", () => {
  const host = "ep-fancy-queen-b30g0cjn.c-4.ap-southeast-1.aws.neon.tech";
  const role = "bci_dev_private_reader";
  const valid = `postgresql://${role}:test-only-not-a-live-secret@${host}/bros_intelligence_dev?sslmode=require`;
  const parsed = parseNeonDevConnection(valid, role);
  assert.ok(parsed);
  for (const value of [
    valid.replace(role, "BROS"), valid.replace("bros_intelligence_dev", "neondb"),
    valid.replace(host, "attacker.test"), valid.replace("sslmode=require", "sslmode=disable"),
    valid + "&sslmode=disable", valid + "&options=-c%20role%3DBROS",
    valid.replace("test-only-not-a-live-secret", ""),
    valid.replace("postgresql:", "https:"),
  ]) assert.throws(() => parseNeonDevConnection(value, role));
});
