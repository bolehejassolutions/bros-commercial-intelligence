import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateEvidenceReader, PrivateEvidenceAccessDenied } from "../lib/bci/private-evidence-boundary.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const ROW = "44444444-4444-4444-8444-444444444444";

function harness({
  user = { userId: USER, authenticated: true },
  grants = [{ principalId: USER, tenantId: A, product: "demand", active: true }],
  rows = [{ id: ROW, tenantId: A, product: "demand", provider: "manual", providerRecordKey: "synthetic-a", metrics: { clicks: 0, purchases: null } }],
} = {}) {
  const calls = [];
  const read = createPrivateEvidenceReader({
    authenticate: async () => { calls.push({ step: "auth" }); return user; },
    membershipsFor: async (principalId, product) => {
      calls.push({ step: "membership", principalId, product });
      return grants;
    },
    readRows: async scope => { calls.push({ step: "db", ...scope }); return rows; },
  });
  return { read, calls };
}

const denied = /private evidence access denied/i;

test("trusted membership derives tenant scope and preserves real zero versus unknown NULL", async () => {
  const { read, calls } = harness();
  const result = await read({ product: "demand" });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].metrics, { clicks: 0, purchases: null });
  assert.deepEqual(calls[2], { step: "db", tenantId: A, product: "demand", limit: 25 });
});

test("default deny: unauthenticated or malformed principal never queries membership or database", async () => {
  for (const user of [null, { userId: USER, authenticated: false }, { userId: "attacker", authenticated: true }]) {
    const { read, calls } = harness({ user });
    await assert.rejects(read({ product: "demand" }), PrivateEvidenceAccessDenied);
    assert.deepEqual(calls.map(c => c.step), ["auth"]);
  }
});

test("client tenantId, userId and other unreviewed keys are rejected before authentication", async () => {
  for (const extra of [{ tenantId: B }, { userId: USER }, { organizationId: B }, { scope: "all" }]) {
    const { read, calls } = harness();
    await assert.rejects(read({ product: "demand", ...extra }), denied);
    assert.equal(calls.length, 0);
  }
});

test("invalid product and unbounded/invalid limits fail closed without touching auth", async () => {
  for (const input of [
    { product: "sell" }, { product: "DEMAND" }, { product: "demand", limit: 0 },
    { product: "demand", limit: 51 }, { product: "demand", limit: -1 },
    { product: "demand", limit: 1.5 }, { product: "demand", limit: NaN },
  ]) {
    const { read, calls } = harness();
    await assert.rejects(read(input), denied);
    assert.equal(calls.length, 0);
  }
});

test("missing, inactive, duplicated or ambiguous tenant membership is denied", async () => {
  const valid = { principalId: USER, tenantId: A, product: "demand", active: true };
  for (const grants of [[], [{ ...valid, active: false }], [valid, { ...valid, tenantId: B }], [valid, valid]]) {
    const { read, calls } = harness({ grants });
    await assert.rejects(read({ product: "demand" }), denied);
    assert.equal(calls.some(x => x.step === "db"), false);
  }
});

test("membership must match verified principal and product exactly", async () => {
  for (const grant of [
    { principalId: "55555555-5555-4555-8555-555555555555", tenantId: A, product: "demand", active: true },
    { principalId: USER, tenantId: A, product: "content", active: true },
    { principalId: USER, tenantId: "spoof", product: "demand", active: true },
  ]) {
    const { read, calls } = harness({ grants: [grant] });
    await assert.rejects(read({ product: "demand" }), denied);
    assert.equal(calls.some(x => x.step === "db"), false);
  }
});

test("cross-tenant database row aborts the entire response, not silently filtered", async () => {
  const { read } = harness({ rows: [
    { id: ROW, tenantId: A, product: "demand", provider: "manual", providerRecordKey: "synthetic-a", metrics: { clicks: 1 } },
    { id: "66666666-6666-4666-8666-666666666666", tenantId: B, product: "demand", provider: "manual", providerRecordKey: "synthetic-b", metrics: { clicks: 5 } },
  ] });
  await assert.rejects(read({ product: "demand" }), denied);
});

test("cross-product row is rejected even within same tenant", async () => {
  const { read } = harness({ rows: [{ id: ROW, tenantId: A, product: "content", provider: "manual", providerRecordKey: "synthetic-content", metrics: {} }] });
  await assert.rejects(read({ product: "demand" }), denied);
});

test("malformed metrics, nonfinite values and oversized DB response fail closed", async () => {
  for (const metrics of [{ purchases: "unknown" }, { clicks: Infinity }, [1, 2], null]) {
    const { read } = harness({ rows: [{ id: ROW, tenantId: A, product: "demand", provider: "manual", providerRecordKey: "x", metrics }] });
    await assert.rejects(read({ product: "demand" }), denied);
  }
  const { read } = harness({ rows: Array.from({ length: 2 }, (_, i) => ({ id: ROW, tenantId: A, product: "demand", provider: "manual", providerRecordKey: String(i), metrics: {} })) });
  await assert.rejects(read({ product: "demand", limit: 1 }), denied);
});

test("provider/identity/membership failures do not fall back to a default tenant", async () => {
  const sample = harness();
  for (const dep of [
    { authenticate: async () => { throw new Error("auth unavailable"); }, membershipsFor: async () => [], readRows: async () => [] },
    { authenticate: async () => ({ userId: USER, authenticated: true }), membershipsFor: async () => { throw new Error("membership unavailable"); }, readRows: async () => [] },
  ]) {
    await assert.rejects(createPrivateEvidenceReader(dep)({ product: "demand" }), /unavailable/);
  }
  assert.equal((await sample.read({ product: "demand" }))[0].tenantId, A);
});

test("does not mutate original evidence objects supplied by DB adapter", async () => {
  const metrics = { purchases: null, clicks: 0 };
  const rows = [{ id: ROW, tenantId: A, product: "demand", provider: "manual", providerRecordKey: "abc", metrics }];
  const { read } = harness({ rows });
  const [result] = await read({ product: "demand" });
  assert.notEqual(result, rows[0]);
  assert.notEqual(result.metrics, metrics);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.metrics), true);
});

test("duplicate database evidence IDs and provider record keys fail closed", async () => {
  const base = { id: ROW, tenantId: A, product: "demand", provider: "manual",
    providerRecordKey: "provider-event-1", metrics: { clicks: 1 } };
  const sameId = { ...base, providerRecordKey: "provider-event-2" };
  const sameProviderKey = { ...base, id: "77777777-7777-4777-8777-777777777777" };
  for (const rows of [[base, base], [base, sameId], [base, sameProviderKey]]) {
    const { read } = harness({ rows });
    await assert.rejects(read({ product: "demand" }), denied);
  }
  const { read } = harness({ rows: [base, { ...sameProviderKey, providerRecordKey: "provider-event-2" }] });
  assert.equal((await read({ product: "demand" })).length, 2);
});


test("unreviewed DB columns and noncanonical metric payloads are denied before serialization", async () => {
  const base = { id: ROW, tenantId: A, product: "demand",
    provider: "manual", providerRecordKey: "synthetic-a", metrics: { clicks: 0 } };
  for (const extra of [
    { customerEmail: "private@example.test" },
    { principalId: USER },
    { admin: true },
  ]) {
    const { read } = harness({ rows: [{ ...base, ...extra }] });
    await assert.rejects(read({ product: "demand" }), denied);
  }
  for (const metrics of [
    JSON.parse('{"__proto__": 1}'),
    { "unreviewed metric": 1 },
    { "Atypical": 2 },
    { clicks: undefined },
    Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`m_${i}`, i])),
  ]) {
    const { read } = harness({ rows: [{ ...base, metrics }] });
    await assert.rejects(read({ product: "demand" }), denied);
  }
  const { read } = harness({ rows: [base] });
  const [row] = await read({ product: "demand" });
  assert.deepEqual(Object.keys(row).sort(), [
    "id", "tenantId", "product", "provider", "providerRecordKey", "metrics",
  ].sort());
  assert.deepEqual(row.metrics, { clicks: 0 });
});


test("rejects hidden, symbol and accessor payload metadata before private evidence serialization", async () => {
  const secret = Symbol("private-credential");
  const base = { id: ROW, tenantId: A, product: "demand",
    provider: "manual", providerRecordKey: "synthetic-a", metrics: { clicks: 0 } };
  const hidden = (value, name) => Object.defineProperty({ ...value }, name, {
    value: "secret-sentinel", enumerable: false,
  });
  const accessor = (value, name) => Object.defineProperty({ ...value }, name, {
    enumerable: true, get() { throw new Error("untrusted getter must not execute"); },
  });
  for (const request of [
    hidden({ product: "demand" }, "tenantId"),
    { product: "demand", [secret]: "secret-sentinel" },
    accessor({ product: "demand" }, "limit"),
  ]) {
    const { read, calls } = harness();
    await assert.rejects(read(request), denied);
    assert.equal(calls.length, 0, "reject unreviewed request metadata before auth");
  }
  for (const row of [
    hidden(base, "customerEmail"),
    { ...base, [secret]: "secret-sentinel" },
    accessor(base, "metrics"),
    { ...base, metrics: hidden(base.metrics, "private_key") },
    { ...base, metrics: { ...base.metrics, [secret]: "secret-sentinel" } },
    { ...base, metrics: accessor(base.metrics, "clicks") },
  ]) {
    const { read } = harness({ rows: [row] });
    await assert.rejects(read({ product: "demand" }), denied);
  }
  const { read } = harness({ rows: [base] });
  assert.deepEqual((await read({ product: "demand" }))[0].metrics, { clicks: 0 });
});
