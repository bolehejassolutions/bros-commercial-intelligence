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
  assert.deepEqual(calls.map(x => x[0]), ["verify", "grant", "read", "verify", "grant"]);
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

test("repository tenant/product isolation breach fails closed without leaking any receipts", async () => {
  for (const badRow of [
    record({ tenantId: "org-B", evidenceId: "cross-tenant" }),
    record({ product: "content", evidenceId: "cross-product" }),
    null,
  ]) {
    const { handler } = fixture({ listScopedReceipts: async () => [record(), badRow] });
    const response = await handler(get());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "read_unavailable" });
  }
});

test("repository wrong-scope-only result is never misreported as NO_ROWS_NOT_ZERO", async () => {
  const { handler } = fixture({ listScopedReceipts: async () => [record({ tenantId: "org-B" })] });
  const response = await handler(get());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "read_unavailable" });
});

test("genuinely empty scoped repository result retains NO_ROWS_NOT_ZERO", async () => {
  const { handler } = fixture({ listScopedReceipts: async () => [] });
  const response = await handler(get());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result, "NO_ROWS_NOT_ZERO");
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


test("unverified subject identifier is denied before membership lookup", async () => {
  let memberships = 0;
  const { handler } = fixture({
    verifyBearerToken: async () => ({ subjectId: "../../admin", expiresAt: "2026-11-08T06:00:00Z" }),
    hasEvidenceReadGrant: async () => { memberships++; return true; },
  });
  assert.equal((await handler(get())).status, 401);
  assert.equal(memberships, 0);
});

test("authoritative membership-provider failure is 503, not an empty-data success", async () => {
  let reads = 0;
  const { handler } = fixture({
    hasEvidenceReadGrant: async () => { throw new Error("PRIVATE_GRANT_ERROR"); },
    listScopedReceipts: async () => { reads++; return [record()]; },
  });
  const response = await handler(get());
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("PRIVATE_GRANT_ERROR"));
  assert.equal(reads, 0);
});

test("production runtime guard denies the unregistered DEV handler", async () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const { handler, calls } = fixture();
    assert.equal((await handler(get())).status, 503);
    assert.equal(calls.length, 0);
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});


test("oversized scoped repository response fails closed instead of silently truncating", async () => {
  const { handler } = fixture({
    listScopedReceipts: async () => Array.from({ length: 21 }, (_, i) =>
      record({ evidenceId: `evidence-${i + 1}` })),
  });
  const response = await handler(get());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "read_unavailable" });
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("repository at the exact 20-row boundary remains readable", async () => {
  const { handler } = fixture({
    listScopedReceipts: async () => Array.from({ length: 20 }, (_, i) =>
      record({ evidenceId: `evidence-${i + 1}` })),
  });
  const response = await handler(get());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.receipts.length, 20);
  assert.equal(body.result, "observed_rows");
});

test("grant revoked after SQL completes blocks disclosure of formerly scoped evidence", async () => {
  let grants = 0;
  let reads = 0;
  const { handler } = fixture({
    hasEvidenceReadGrant: async () => ++grants === 1,
    listScopedReceipts: async () => { reads++; return [record()]; },
  });
  const response = await handler(get());
  assert.equal(response.status, 403);
  assert.equal(await response.text(), JSON.stringify({ error: "access_denied" }));
  assert.equal(grants, 2);
  assert.equal(reads, 1);
});

test("bearer revoked during SQL read returns 401 before post-read membership check", async () => {
  let verifies = 0, grants = 0;
  const { handler } = fixture({
    verifyBearerToken: async () => ++verifies === 1
      ? { subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z" } : null,
    hasEvidenceReadGrant: async () => { grants++; return true; },
  });
  const response = await handler(get());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(verifies, 2);
  assert.equal(grants, 1);
});

test("changed post-read subject and changed token expiration are denied", async () => {
  for (const second of [
    { subjectId: "user-2", expiresAt: "2026-11-08T06:00:00Z" },
    { subjectId: "user-1", expiresAt: "2026-11-08T07:00:00Z" },
    { subjectId: "user-1", expiresAt: "2026-11-08T04:59:59Z" },
  ]) {
    let verifies = 0;
    const { handler } = fixture({
      verifyBearerToken: async () => ++verifies === 1
        ? { subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z" } : second,
    });
    const response = await handler(get());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(verifies, 2);
  }
});

test("token that expires while repository reads cannot disclose evidence", async () => {
  let clocks = 0;
  const { handler } = fixture({
    now: () => ++clocks === 1 ? NOW : Date.parse("2026-11-08T06:00:00Z"),
  });
  const response = await handler(get());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(clocks, 2);
});

test("post-read authoritative membership service failure returns generic 503", async () => {
  let checks = 0;
  const { handler } = fixture({
    hasEvidenceReadGrant: async () => {
      if (++checks === 2) throw Error("PRIVATE_GRANT_BACKEND_DIAGNOSTIC");
      return true;
    },
  });
  const response = await handler(get());
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body, JSON.stringify({ error: "read_unavailable" }));
  assert.equal(checks, 2);
});

test("post-read session rotation with unchanged user and expiry is denied", async () => {
  let verifies = 0;
  let grants = 0;
  const { handler } = fixture({
    verifyBearerToken: async () => ({
      subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z",
      sessionId: ++verifies === 1 ? "session-A" : "session-B",
    }),
    hasEvidenceReadGrant: async () => { grants++; return true; },
  });
  const response = await handler(get());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(verifies, 2);
  assert.equal(grants, 1);
});

test("stable verified session can pass second identity and membership check", async () => {
  let verifies = 0;
  const { handler } = fixture({
    verifyBearerToken: async () => {
      verifies++;
      return { subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z", sessionId: "session-A" };
    },
  });
  const response = await handler(get());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(verifies, 2);
  assert.equal(body.access, "read_only");
  assert.ok(!JSON.stringify(body).includes("session-A"));
});

test("invalid verified session ID fails closed before returning receipts", async () => {
  const { handler } = fixture({
    verifyBearerToken: async () => ({
      subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z",
      sessionId: "../../untrusted",
    }),
  });
  const response = await handler(get());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
});

test("malformed verified session identifiers are denied before membership and SQL", async () => {
  for (const sessionId of ["", "../../untrusted", "bad session", 17, null, "x".repeat(129)]) {
    let grants = 0, reads = 0;
    const { handler } = fixture({
      verifyBearerToken: async () => ({
        subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z", sessionId,
      }),
      hasEvidenceReadGrant: async () => { grants++; return true; },
      listScopedReceipts: async () => { reads++; return [record()]; },
    });
    const response = await handler(get());
    assert.equal(response.status, 401, "invalid session must deny");
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(grants, 0, "membership lookup must not run");
    assert.equal(reads, 0, "evidence query must not run");
  }
});


test("post-read session binding downgrade or upgrade denies before membership recheck", async () => {
  for (const [first, second] of [
    [undefined, "session-A"],
    ["session-A", undefined],
  ]) {
    let verifications = 0, grants = 0;
    const { handler } = fixture({
      verifyBearerToken: async () => ({
        subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z",
        sessionId: ++verifications === 1 ? first : second,
      }),
      hasEvidenceReadGrant: async () => { grants++; return true; },
    });
    const response = await handler(get());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(verifications, 2);
    assert.equal(grants, 1);
  }
});


test("mutable verifier principal cannot change identity during membership lookup", async () => {
  const first = { subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z", sessionId: "session-A" };
  let verifies = 0, grants = 0;
  const { handler } = fixture({
    verifyBearerToken: async () => ++verifies === 1 ? first : {
      subjectId: "user-2", expiresAt: first.expiresAt, sessionId: "session-B",
    },
    hasEvidenceReadGrant: async () => {
      grants++;
      if (grants === 1) {
        first.subjectId = "user-2";
        first.sessionId = "session-B";
      }
      return true;
    },
  });
  const response = await handler(get());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(grants, 1);
});

test("mutable verifier principal cannot extend expiry while evidence SQL is pending", async () => {
  const first = { subjectId: "user-1", expiresAt: "2026-11-08T06:00:00Z", sessionId: "session-A" };
  let verifies = 0, grants = 0;
  const { handler } = fixture({
    verifyBearerToken: async () => ++verifies === 1 ? first : {
      subjectId: first.subjectId, expiresAt: "2026-11-08T07:00:00Z", sessionId: first.sessionId,
    },
    hasEvidenceReadGrant: async () => { grants++; return true; },
    listScopedReceipts: async () => {
      first.expiresAt = "2026-11-08T07:00:00Z";
      return [record()];
    },
  });
  const response = await handler(get());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(grants, 1);
});

test("token expiring during final membership recheck denies evidence disclosure", async () => {
  let clocks = 0, grants = 0;
  const { handler } = fixture({
    now: () => ++clocks === 3 ? Date.parse("2026-11-08T06:00:00Z") : NOW,
    hasEvidenceReadGrant: async () => { grants++; return true; },
  });
  const response = await handler(get());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(clocks, 3);
  assert.equal(grants, 2);
});

test("token remaining valid through final membership recheck can disclose scoped evidence", async () => {
  let clocks = 0;
  const { handler } = fixture({ now: () => { clocks++; return NOW; } });
  const response = await handler(get());
  assert.equal(response.status, 200);
  assert.equal(clocks, 3);
  assert.equal((await response.json()).access, "read_only");
});
