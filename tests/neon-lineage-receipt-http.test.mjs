import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLineageReceiptHttpHandler } from "../lib/bci/neon-lineage-receipt-http.ts";
const host = "https://bci.example.test";
const path = host + "/api/internal/neon-lineage-receipt";
const receiptId = "4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/neon-bci-dev-ledger-20261025",
  BCI_NEON_DEV_PRIVATE_READS: "enabled", BCI_NEON_DEV_LINEAGE_RECEIPT_WRITES: "enabled" };
const req = (url = path, headers = {}, body) => new Request(url, {
  method: "POST", headers: { origin: host, authorization: "Bearer aaa.bbb.ccc", ...headers },
  ...(body === undefined ? {} : { body }),
});
const make = (delta = {}, response = {}) => {
  let calls = 0;
  return { calls: () => calls, handle: createLineageReceiptHttpHandler({
    env: () => ({ ...env, ...delta }), execute: async () => {
      calls++;
      return { receiptId, status: "inserted", stage: "evidence",
        verification: "unverified", providerAttested: false, ...response };
    },
  }) };
};
test("signed DEV POST returns only fixed UNVERIFIED evidence-stage receipt", async () => {
  const h = make(), r = await h.handle(req());
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await r.json(), { receiptId, status: "inserted", stage: "evidence",
    verification: "unverified", providerAttested: false });
  assert.equal(h.calls(), 1);
});
test("accepts a zero-byte POST stream but rejects streamed payloads", async () => {
  const h = make();
  const headers = { origin: host, authorization: "Bearer aaa.bbb.ccc" };
  const stream = (bytes) => new ReadableStream({ start(controller) {
    if (bytes !== null) controller.enqueue(new Uint8Array(bytes));
    controller.close();
  } });
  const empty = new Request(path, { method: "POST", headers,
    body: stream(null), duplex: "half" });
  assert.equal((await h.handle(empty)).status, 200);
  assert.equal(h.calls(), 1);
  for (const bytes of [[97], []]) {
    const payload = new Request(path, { method: "POST", headers,
      body: stream(bytes), duplex: "half" });
    assert.equal((await h.handle(payload)).status, 400);
  }
  assert.equal(h.calls(), 1);
});
test("same snapshot replay remains bounded and does not claim attestation", async () => {
  const h = make({}, { status: "replayed" });
  assert.equal((await h.handle(req())).status, 200);
  assert.equal(h.calls(), 1);
});
test("branch, read and narrow-write flags deny before execution", async () => {
  for (const delta of [{ BCI_NEON_DEV_LINEAGE_RECEIPT_WRITES: undefined },
    { VERCEL_ENV: "production" }, { VERCEL_GIT_COMMIT_REF: "main" },
    { BCI_NEON_DEV_PRIVATE_READS: "disabled" }]) {
    const h = make(delta);
    assert.equal((await h.handle(req())).status, 404);
    assert.equal(h.calls(), 0);
  }
});
test("rejects untrusted scope, body, query, cross origin, invalid token", async () => {
  const h = make();
  for (const request of [req(path + "?receiptId=" + receiptId),
    req(path, { "x-tenant-id": "spoof" }), req(path, { origin: "https://evil.test" }),
    req(path, { "sec-fetch-site": "cross-site" }), req(path, { authorization: "" }),
    req(path, { "content-type": "application/json" }),
    req(path, { "content-type": "text/plain" }, "hello")]) {
    assert.notEqual((await h.handle(request)).status, 200);
  }
  assert.equal(h.calls(), 0);
});
test("malformed or privileged result and secret exceptions fail closed", async () => {
  for (const bad of [{ verification: "verified" }, { providerAttested: true },
    { receiptId: "33333333-3333-4333-8333-333333333333" }, { stage: "action" }]) {
    const h = make({}, bad);
    assert.equal((await h.handle(req())).status, 403);
  }
  const handler = createLineageReceiptHttpHandler({ env: () => env,
    execute: async () => { throw new Error("sensitive password"); } });
  const r = await handler(req());
  assert.equal(r.status, 403);
  assert.doesNotMatch(JSON.stringify(await r.json()), /password/);
});
test("lineage endpoint bypasses unrelated Supabase proxy and requires operator UI", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../app/internal/neon-preview/sign-in-client.tsx", import.meta.url), "utf8");
  assert.match(proxy, /request\.nextUrl\.pathname === "\/api\/internal\/neon-lineage-receipt"/);
  assert.match(ui, /Append existing Meta receipt to unverified lineage/);
});
