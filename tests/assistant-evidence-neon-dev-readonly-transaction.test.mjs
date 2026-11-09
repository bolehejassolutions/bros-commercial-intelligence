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
    "SET LOCAL search_path = pg_catalog",
    "SET LOCAL row_security = on",
    "SELECT $1::text", "ROLLBACK",
  ]);
  assert.deepEqual(f.calls[6].params, ["synthetic"]);
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


test("escaped query capability is revoked after successful callback and pool release", async () => {
  const f = fixture();
  let escaped;
  await f.transaction(async query => { escaped = query; return "ok"; });
  const before = f.calls.length;
  await assert.rejects(() => escaped("SELECT $1", ["outside-transaction"]), DevReadTransactionUnavailable);
  assert.equal(f.calls.length, before);
  assert.deepEqual(f.releases, [undefined]);
});
test("escaped query capability is revoked after callback exception", async () => {
  const f = fixture();
  let escaped;
  await assert.rejects(() => f.transaction(async query => {
    escaped = query;
    throw Error("private-error");
  }), DevReadTransactionUnavailable);
  const before = f.calls.length;
  await assert.rejects(() => escaped("SELECT 42", []), DevReadTransactionUnavailable);
  assert.equal(f.calls.length, before);
});
test("detached SQL must settle before rollback and connection release", async () => {
  const events = [];
  let finishQuery;
  const pool = { async connect() {
    return {
      async query(sql) {
        events.push(sql);
        if (sql === "SELECT slow") return await new Promise(resolve => { finishQuery = resolve; });
        return { rows: [] };
      },
      release() { events.push("RELEASE"); },
    };
  }};
  const transaction = createBusinessOsDevReadOnlyTransaction(pool);
  let escaped;
  const operation = transaction(async query => {
    escaped = query;
    void query("SELECT slow", []);
    return "ok";
  });
  // Let the callback return and the detached SQL become pending.
  for (let i = 0; i < 20 && !finishQuery; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finishQuery, "function");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!events.includes("ROLLBACK"));
  assert.ok(!events.includes("RELEASE"));
  await assert.rejects(() => escaped("SELECT after-callback", []), DevReadTransactionUnavailable);
  finishQuery({ rows: [] });
  assert.equal(await operation, "ok");
  assert.deepEqual(events.slice(-2), ["ROLLBACK", "RELEASE"]);
  assert.ok(!events.includes("SELECT after-callback"));
});


test("detached SQL rejection after callback returns poisons result and rolls back", async () => {
  const events = [];
  let rejectDetached;
  const pool = { async connect() {
    return {
      async query(sql) {
        events.push(sql);
        if (sql === "SELECT delayed failure") {
          return await new Promise((_, reject) => { rejectDetached = reject; });
        }
        return { rows: [] };
      },
      release(error) { events.push(error ? "DISCARD" : "RELEASE"); },
    };
  }};
  const transaction = createBusinessOsDevReadOnlyTransaction(pool);
  const result = transaction(async query => {
    // Detached query deliberately has its own rejection observer. A real
    // driver may reject even after the callback has already returned.
    void query("SELECT delayed failure", []).catch(() => {});
    return "must-never-succeed";
  });
  for (let i = 0; i < 20 && !rejectDetached; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(typeof rejectDetached, "function");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!events.includes("ROLLBACK"));
  rejectDetached(Error("PRIVATE_DB_CREDENTIAL"));
  await assert.rejects(result, e =>
    e instanceof DevReadTransactionUnavailable && !e.message.includes("PRIVATE"));
  assert.deepEqual(events.slice(-2), ["ROLLBACK", "RELEASE"]);
});

test("an awaited failed SQL cannot be caught by callback to return a success", async () => {
  const f = fixture({ failAt: "SELECT denied" });
  await assert.rejects(() => f.transaction(async query => {
    try { await query("SELECT denied", []); } catch { /* swallow */ }
    return "must-never-succeed";
  }), DevReadTransactionUnavailable);
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
});

test("a poisoned inherited search_path cannot survive the restricted transaction setup", async () => {
  const f = fixture();
  await f.transaction(async query => {
    // Both settings MUST be applied before any server-owned reader SQL.
    assert.deepEqual(f.calls.slice(4, 6).map(x => x.sql), [
      "SET LOCAL search_path = pg_catalog", "SET LOCAL row_security = on",
    ]);
    await query("SELECT current_user", []);
  });
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
  assert.deepEqual(f.releases, [undefined]);
});

test("failure to pin search_path or RLS posture denies all reader SQL", async () => {
  for (const failAt of ["SET LOCAL search_path", "SET LOCAL row_security"]) {
    const f = fixture({ failAt });
    let reached = false;
    await assert.rejects(() => f.transaction(async () => { reached = true; }),
      error => error instanceof DevReadTransactionUnavailable &&
        !error.message.includes("PRIVATE"));
    assert.equal(reached, false);
    assert.equal(f.calls.at(-1).sql, "ROLLBACK");
    assert.equal(f.releases.length, 1);
  }
});


test("caught driver rejection immediately revokes follow-up SQL capability", async () => {
  const f = fixture({ failAt: "SELECT denied" });
  await assert.rejects(() => f.transaction(async query => {
    await assert.rejects(() => query("SELECT denied", []));
    await assert.rejects(() => query("SELECT should-not-dispatch", []),
      DevReadTransactionUnavailable);
    return "must-never-succeed";
  }), DevReadTransactionUnavailable);
  assert.equal(f.calls.some(x => x.sql === "SELECT should-not-dispatch"), false);
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
});

test("invalid SQL poisons the query capability even if caller swallows denial", async () => {
  const f = fixture();
  await assert.rejects(() => f.transaction(async query => {
    await assert.rejects(() => query("SELECT 1; SELECT 2", []),
      DevReadTransactionUnavailable);
    await assert.rejects(() => query("SELECT should-not-dispatch", []),
      DevReadTransactionUnavailable);
    return "must-never-succeed";
  }), DevReadTransactionUnavailable);
  assert.equal(f.calls.some(x => x.sql === "SELECT should-not-dispatch"), false);
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
});
