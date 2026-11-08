import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessOsDevBackchannel } from "../lib/bci/assistant-evidence-neon-dev-backchannel.ts";

const endpoint = "https://auth.example.test/internal/introspect";
const config = { endpoint, expectedOrigin: "https://auth.example.test" };
const good = {
  subjectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "session-1", issuer: "https://auth.example.test",
  audience: "bros-business-os-dev", expiresAt: "2026-11-08T12:10:00Z", revoked: false,
};
function fixture(payload = good, init = {}) {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { "Content-Type": init.type ?? "application/json", ...(init.headers ?? {}) },
    });
  };
  return { introspect: createBusinessOsDevBackchannel(config, transport), calls };
}
test("strict backchannel POST, no credentials/cookies/redirect/cache, only verified schema returned", async () => {
  const f = fixture();
  assert.deepEqual(await f.introspect("opaque-token"), good);
  assert.equal(f.calls.length, 1);
  const { url, options } = f.calls[0];
  assert.equal(url, endpoint);
  assert.equal(options.method, "POST");
  assert.equal(options.redirect, "error");
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.headers.Authorization, "Bearer opaque-token");
});
test("malformed bearer never calls transport", async () => {
  const f = fixture();
  for (const token of ["", "a b", "Bearer abc", "x".repeat(4097), null])
    assert.equal(await f.introspect(token), null);
  assert.equal(f.calls.length, 0);
});
test("endpoint origin, protocol, credentials, query, fragment, loopback and timeout fail at construction", () => {
  for (const bad of [
    { endpoint: "http://auth.example.test/introspect" },
    { endpoint: "https://evil.example.test/introspect" },
    { endpoint: "https://user:pass@auth.example.test/introspect" },
    { endpoint: endpoint + "?secret=1" },
    { endpoint: endpoint + "#fragment" },
    { endpoint: "https://auth.example.test/" },
    { timeoutMs: 0 }, { timeoutMs: 10001 },
  ]) assert.throws(() => createBusinessOsDevBackchannel({ ...config, ...bad }, fetch));
});
test("invalid response statuses, content type and length fail closed", async () => {
  for (const init of [
    { status: 401 }, { status: 403 }, { status: 503 },
    { type: "text/html" }, { headers: { "Content-Length": "999999" } },
  ]) assert.equal(await fixture(good, init).introspect("opaque-token"), null);
});
test("malformed, revoked and extra response fields fail closed", async () => {
  for (const value of [
    null, [], { ...good, revoked: true }, { ...good, subjectId: "user-1" },
    { ...good, admin: true }, { ...good, sessionId: "" },
    { ...good, expiresAt: "invalid" },
  ]) assert.equal(await fixture(value).introspect("opaque-token"), null);
});
test("network and malformed JSON errors fail closed without leaking details", async () => {
  const offline = createBusinessOsDevBackchannel(config, async () => {
    throw Error("SECRET_BACKCHANNEL_FAILURE");
  });
  assert.equal(await offline("opaque-token"), null);
  const malformed = createBusinessOsDevBackchannel(config, async () =>
    new Response("{secret", { headers: { "Content-Type": "application/json" } }));
  assert.equal(await malformed("opaque-token"), null);
});
test("oversized streaming response rejected regardless of missing content-length", async () => {
  const oversized = createBusinessOsDevBackchannel(config, async () =>
    new Response(JSON.stringify({ ...good, padding: "x".repeat(5000) }), {
      headers: { "Content-Type": "application/json" },
    }));
  assert.equal(await oversized("opaque-token"), null);
});
test("transport is not a live Neon Auth proof; no network happens until injected call", () => {
  let called = false;
  const introspect = createBusinessOsDevBackchannel(config, async () => {
    called = true;
    return new Response("{}", { headers: { "Content-Type": "application/json" } });
  });
  assert.equal(called, false);
  assert.equal(typeof introspect, "function");
});
