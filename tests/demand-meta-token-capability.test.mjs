import test from "node:test";
import assert from "node:assert/strict";
import { inspectExistingDemandMetaToken } from "../lib/demand/meta-token-capability.ts";
const token = "synthetic-business-owned-token-12345", now = Date.parse("2026-11-02T00:00:00Z");
function fixture({ scopes = ["ads_read"], permissionScopes = scopes, debugCode, empty = false } = {}) {
  const calls = [];
  const transport = async (url, init) => {
    calls.push({ url, init }); const path = new URL(url).pathname;
    if (path.endsWith("/permissions")) return Response.json({ data: empty ? [] : permissionScopes.map(permission => ({ permission, status: "granted" })) });
    if (path.endsWith("/debug_token")) return debugCode ? Response.json({ error: { code: debugCode, message: token } }, { status: 400 }) :
      Response.json({ data: { app_id: "1315572270590189", is_valid: true, expires_at: 0, scopes, user_id: "PRIVATE-USER" } });
    return Response.json({ id: "act_1997776120879476", account_id: "1997776120879476", account_status: 1, currency: "MYR", timezone_name: "Asia/Kuala_Lumpur" });
  };
  return { calls, transport };
}
test("reported read-only grant is distinguished from management without enabling any write", async () => {
  const f = fixture(); const r = await inspectExistingDemandMetaToken(token, f.transport, now);
  assert.equal(r.adsRead, "GRANTED"); assert.equal(r.adsManagement, "NOT_GRANTED");
  assert.equal(r.appBindingVerified, true); assert.equal(r.fixedAccountReadVerified, true);
  assert.equal(r.executionAllowed, false); assert.equal(r.managementConnectionVerified, false);
  assert.equal(r.credentialChanged, false); assert.equal(f.calls.length, 3);
  for (const c of f.calls) {
    assert.equal(c.init.method, "GET"); assert.equal(c.init.redirect, "error"); assert.equal(c.init.cache, "no-store");
    assert.ok(c.init.signal); assert.equal(c.init.body, undefined); assert.equal(new URL(c.url).origin, "https://graph.facebook.com");
  }
  assert.ok(!JSON.stringify(r).includes(token)); assert.ok(!JSON.stringify(r).includes("PRIVATE-USER"));
});
test("a reporting variable name does not hide an already-granted management scope", async () => {
  const f = fixture({ scopes: ["ads_read", "ads_management"] });
  const r = await inspectExistingDemandMetaToken(token, f.transport, now);
  assert.equal(r.adsManagement, "GRANTED"); assert.equal(r.executionAllowed, false);
});
test("unsupported self-debug stays unverified while a complete permission read can still report its scopes", async () => {
  const f = fixture({ debugCode: 100 }); const r = await inspectExistingDemandMetaToken(token, f.transport, now);
  assert.equal(r.permissionReadbackVerified, true); assert.equal(r.debugReadbackVerified, false);
  assert.equal(r.appBindingVerified, false); assert.equal(r.adsManagement, "NOT_GRANTED"); assert.equal(r.debugCode, 100);
});
test("empty, malformed, paginated and conflicting metadata never become permission proof", async () => {
  const conflict = fixture({ scopes: ["ads_read"], permissionScopes: ["ads_read", "ads_management"] });
  assert.equal((await inspectExistingDemandMetaToken(token, conflict.transport, now)).adsManagement, "UNVERIFIED");
  const empty = fixture({ empty: true, debugCode: 100 });
  assert.equal((await inspectExistingDemandMetaToken(token, empty.transport, now)).adsManagement, "UNVERIFIED");
  const f = fixture({ debugCode: 100 });
  const r = await inspectExistingDemandMetaToken(token, async (url, init) => new URL(url).pathname.endsWith("/permissions") ?
    Response.json({ data: [{ permission: "ads_management", status: "granted" }], paging: { next: "https://evil.invalid" } }) : f.transport(url, init), now);
  assert.equal(r.adsManagement, "UNVERIFIED");
});
test("missing credentials never call Meta; secret-bearing errors are fully redacted", async () => {
  let calls = 0;
  const transport = async () => { calls++; throw Error("secret=" + token); };
  const missing = await inspectExistingDemandMetaToken("", transport, now); assert.equal(calls, 0);
  assert.equal(missing.status, "MISSING_SERVER_CREDENTIAL");
  const denied = await inspectExistingDemandMetaToken(token, transport, now);
  assert.equal(denied.adsManagement, "UNVERIFIED"); assert.ok(!JSON.stringify(denied).includes(token));
});
