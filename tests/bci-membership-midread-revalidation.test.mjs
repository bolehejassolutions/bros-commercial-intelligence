import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateEvidenceReader, PrivateEvidenceAccessDenied } from "../lib/bci/private-evidence-boundary.ts";

// Pure synthetic transaction interleavings only. A real restricted-login
// concurrency test still requires an approved DEV database test.
const USER = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ROW = Object.freeze({
  id: "44444444-4444-4444-8444-444444444444",
  tenantId: TENANT, product: "content", provider: "manual",
  providerRecordKey: "untrusted-synthetic-only", metrics: { clicks: 0, sales: null },
});
const grant = Object.freeze({
  principalId: USER, tenantId: TENANT, product: "content", active: true,
});
const otherGrant = Object.freeze({ ...grant, tenantId: OTHER });

function createInterleavedRead(changeDuringEvidence = () => {}) {
  const calls = [];
  let grants = [grant];
  const read = createPrivateEvidenceReader({
    authenticate: async () => {
      calls.push("authenticate");
      return { userId: USER, authenticated: true };
    },
    membershipsFor: async (principal, product) => {
      calls.push("membership");
      assert.equal(principal, USER);
      assert.equal(product, "content");
      return grants.slice();
    },
    readRows: async scope => {
      calls.push("evidence");
      assert.deepEqual(scope, { tenantId: TENANT, product: "content", limit: 1 });
      changeDuringEvidence({ replaceMemberships: next => { grants = next; } });
      return [ROW];
    },
  });
  return { calls, read: () => read({ product: "content", limit: 1 }) };
}

test("authorized evidence is released only after a second membership lookup", async () => {
  const flow = createInterleavedRead();
  assert.deepEqual(await flow.read(), [ROW]);
  assert.deepEqual(flow.calls, ["authenticate", "membership", "evidence", "membership"]);
});

test("membership revoked while evidence is read denies entire positive response", async () => {
  const flow = createInterleavedRead(({ replaceMemberships }) => replaceMemberships([]));
  await assert.rejects(flow.read(), PrivateEvidenceAccessDenied);
  assert.deepEqual(flow.calls, ["authenticate", "membership", "evidence", "membership"]);
});

test("reassignment to another tenant or product fails closed before serialization", async () => {
  for (const altered of [[otherGrant], [{ ...grant, product: "demand" }],
    [grant, otherGrant], [{ ...grant, active: false }]]) {
    const flow = createInterleavedRead(({ replaceMemberships }) => replaceMemberships(altered));
    await assert.rejects(flow.read(), PrivateEvidenceAccessDenied);
    assert.deepEqual(flow.calls, ["authenticate", "membership", "evidence", "membership"]);
  }
});

test("failed authoritative membership recheck cannot reuse earlier success", async () => {
  let lookups = 0;
  const reader = createPrivateEvidenceReader({
    authenticate: async () => ({ userId: USER, authenticated: true }),
    membershipsFor: async () => {
      lookups++;
      if (lookups === 2) throw new Error("membership-store-unavailable");
      return [grant];
    },
    readRows: async () => [ROW],
  });
  await assert.rejects(reader({ product: "content", limit: 1 }), /membership-store-unavailable/);
  assert.equal(lookups, 2);
});

// This closes only an in-flight stale-membership window. A change after the
// second check remains possible without a single authoritative DB transaction.
