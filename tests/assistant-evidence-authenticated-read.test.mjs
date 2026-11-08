import test from "node:test";
import assert from "node:assert/strict";
import { createDevEvidenceReadHandler } from "../lib/bci/assistant-evidence-authenticated-read.ts";

const URL_ = "https://internal.example/internal/dev/bros-business-os/evidence?tenant_id=org-A&product=demand";
const NOW = Date.parse("2026-11-08T05:00:00Z");
const record = (override = {}) => ({
  schemaVersion: 1, evidenceId: "evidence-1", tenantId: "org-A", product: "demand", category: "ads",
  provenance: {
    provider: "meta_ads", providerObjectId: "secret-account",
    collectedAt: "2026-11-08T04:00:00Z", observedAt: null,
    windowStart: null, windowEnd: null,
    sourceReference: "meta:event-1", completeness: "partial",
  },
  metrics: { spend_myr: null, pixel_purchase_events: 10, paid_orders: null },
  internalPayload: { secret: "PRIVATE" }, ...override,
});
const get = (url = URL_, authorization = "Bearer valid") =>
  new Request(url, { headers: authorization ? { authorization } : {} });
function fixture(overrides = {}) {
  const calls = [];
  const deps = {
    now: () => NOW,
    verifyBearerToken: async token => {
      calls.push(["verify", token]);
      return { subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z" };
    },
    hasEvidenceReadGrant: async (subject, scope) => {
      calls.push(["grant", subject, scope]); return true;
    },
    listScopedReceipts: async scope => {
      calls.push(["read", scope]); return [record()];
    },
    ...overrides,
  };
  return { handler: createDevEvidenceReadHandler(deps), calls };
}

test("authorized read requires identity, grant and independently scoped storage in order", async () => {
  const { handler, calls } = fixture();
  const res = await handler(get()), body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map(x => x[0]), ["verify", "grant", "read"]);
  assert.deepEqual(calls[1].slice(1), ["user-1", { tenantId: "org-A", product: "demand" }]);
  assert.deepEqual(calls[2][1], { tenantId: "org-A", product: "demand", maxRows: 20 });
  assert.equal(body.access, "read_only");
  assert.equal(body.receipts[0].metrics.spend_myr, null);
  assert.equal(body.receipts[0].metrics.pixel_purchase_events, 10);
  assert.ok(!JSON.stringify(body).includes("PRIVATE"));
  assert.ok(!JSON.stringify(body).includes("secret-account"));
  assert.equal(res.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("missing bearer is 401 before any provider or DB call", async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(get(URL_, null))).status, 401);
  assert.equal(calls.length, 0);
});

test("revoked or unknown access token is 401", async () => {
  let checked = 0;
  const { handler } = fixture({
    verifyBearerToken: async () => null,
    hasEvidenceReadGrant: async () => { checked++; return true; },
  });
  assert.equal((await handler(get())).status, 401);
  assert.equal(checked, 0);
});

test("expired verified session cannot reach tenant grant or storage", async () => {
  let checked = 0;
  const { handler } = fixture({
    verifyBearerToken: async () => ({ subjectId: "user-1", expiresAt: "2026-11-08T04:59:59Z" }),
    hasEvidenceReadGrant: async () => { checked++; return true; },
  });
  assert.equal((await handler(get())).status, 401);
  assert.equal(checked, 0);
});

test("unapproved tenant is 403 and cannot trigger storage query", async () => {
  let reads = 0;
  const { handler } = fixture({
    hasEvidenceReadGrant: async () => false,
    listScopedReceipts: async () => { reads++; return [record()]; },
  });
  assert.equal((await handler(get())).status, 403);
  assert.equal(reads, 0);
});

test("product-specific grant is mandatory independent of identity", async () => {
  let reads = 0;
  const { handler } = fixture({
    hasEvidenceReadGrant: async (_subject, scope) => scope.product === "content",
    listScopedReceipts: async () => { reads++; return [record()]; },
  });
  assert.equal((await handler(get())).status, 403);
  assert.equal(reads, 0);
});

test("actor spoof, unknown or duplicate selectors, invalid product and malformed tenant reject before authentication", async () => {
  const { handler, calls } = fixture();
  const rejected = [
    URL_ + "&actor=admin", URL_ + "&tenant_id=org-B", URL_ + "&role=superuser",
    URL_.replace("demand", "sell"), URL_.replace("org-A", "org%2FA"),
  ];
  for (const url of rejected) assert.equal((await handler(get(url))).status, 400);
  assert.equal(calls.length, 0);
});

test("POST cannot write and is rejected before authentication", async () => {
  const { handler, calls } = fixture();
  const res = await handler(new Request(URL_, { method: "POST", headers: { authorization: "Bearer valid" } }));
  assert.equal(res.status, 405);
  assert.equal(calls.length, 0);
});

test("mis-scoped database rows do not bypass tenant and product projection filters", async () => {
  const { handler } = fixture({
    listScopedReceipts: async () => [
      record({ tenantId: "org-B", evidenceId: "cross-tenant" }),
      record({ product: "content", evidenceId: "cross-product" }),
      record(),
    ],
  });
  const body = await (await handler(get())).json();
  assert.deepEqual(body.receipts.map(row => row.evidenceId), ["evidence-1"]);
});

test("other-tenant-only result is NO_ROWS_NOT_ZERO, never zero", async () => {
  const { handler } = fixture({ listScopedReceipts: async () => [record({ tenantId: "org-B" })] });
  const body = await (await handler(get())).json();
  assert.equal(body.result, "NO_ROWS_NOT_ZERO");
  assert.deepEqual(body.receipts, []);
});

test("data source error is generic 503 and never reveals provider details", async () => {
  const { handler } = fixture({ listScopedReceipts: async () => { throw Error("DB_TOKEN_SECRET"); } });
  const res = await handler(get());
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes("DB_TOKEN_SECRET"));
});

test("missing server adapters fail closed", async () => {
  const { handler } = fixture({ hasEvidenceReadGrant: null });
  assert.equal((await handler(get())).status, 503);
});

test("responses never expose bearer tokens", async () => {
  const { handler } = fixture();
  const res = await handler(get(URL_, "Bearer TOKEN_SUPER_SECRET"));
  assert.ok(!(await res.text()).includes("TOKEN_SUPER_SECRET"));
});

test("malformed credentials fail before provider access", async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(get(URL_, "Basic abc"))).status, 401);
  assert.equal(calls.length, 0);
});

test("a storage adapter contract violation is not treated as empty results", async () => {
  const { handler } = fixture({ listScopedReceipts: async () => null });
  assert.equal((await handler(get())).status, 503);
});
