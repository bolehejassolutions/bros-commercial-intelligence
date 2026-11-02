import test from "node:test";
import assert from "node:assert/strict";
import { pilotMetaConfiguration } from "../lib/demand/meta-pilot-environment.ts";
import { inspectMetaConnection } from "../lib/marketing-operator/meta-connection.ts";

const token = "synthetic-owner-management-token-123456";
test("owner-saved DEMAND credential reaches the unchanged management verifier", async () => {
  const input = { BROS_DEMAND_META_ADS_MANAGEMENT_TOKEN: token,
    META_APP_ID: "1315572270590189", META_APP_SECRET: "synthetic-app-secret-123456" };
  const { environment, managementCredentialConflict } = pilotMetaConfiguration(input);
  assert.equal(managementCredentialConflict, false);
  assert.equal(environment.META_ADS_MANAGEMENT_TOKEN, token);
  assert.equal(input.META_ADS_MANAGEMENT_TOKEN, undefined);
  let calls = 0;
  const result = await inspectMetaConnection("write", environment, async (url, init) => {
    calls++;
    assert.equal(init.method, "GET");
    assert.equal(new URL(url).searchParams.get("input_token"), token);
    assert.ok(new URL(url).searchParams.get("appsecret_proof"));
    return Response.json({ data: { is_valid: true, app_id: input.META_APP_ID,
      expires_at: 0, scopes: ["ads_read"] } });
  });
  assert.equal(calls, 1);
  assert.equal(result.reason, "TOKEN_SCOPE_MISSING");
  assert.equal(result.status, "BLOCKED");
  assert.ok(!JSON.stringify(result).includes(token));
});
test("legacy configuration stays supported and matching explicit names are unambiguous", () => {
  assert.equal(pilotMetaConfiguration({ META_ADS_MANAGEMENT_TOKEN: token }).environment.META_ADS_MANAGEMENT_TOKEN, token);
  const same = pilotMetaConfiguration({ META_ADS_MANAGEMENT_TOKEN: token, BROS_DEMAND_META_ADS_MANAGEMENT_TOKEN: token });
  assert.equal(same.managementCredentialConflict, false);
  assert.equal(same.environment.META_ADS_MANAGEMENT_TOKEN, token);
});
test("conflicting management credentials block before Meta and never choose silently", async () => {
  const resolved = pilotMetaConfiguration({ META_ADS_MANAGEMENT_TOKEN: "synthetic-other-token-123456",
    BROS_DEMAND_META_ADS_MANAGEMENT_TOKEN: token,
    META_APP_ID: "1315572270590189", META_APP_SECRET: "synthetic-app-secret-123456" });
  assert.equal(resolved.managementCredentialConflict, true);
  assert.equal(resolved.environment.META_ADS_MANAGEMENT_TOKEN, undefined);
  let calls = 0;
  const result = await inspectMetaConnection("write", resolved.environment, async () => { calls++; throw Error(); });
  assert.equal(calls, 0); assert.equal(result.status, "BLOCKED");
});
test("a working reporting token never supplies missing management credentials", () => {
  const resolved = pilotMetaConfiguration({ BROS_DEMAND_META_ADS_READ_TOKEN: token, META_ADS_READ_TOKEN: token });
  assert.equal(resolved.environment.META_ADS_MANAGEMENT_TOKEN, undefined);
  assert.equal(resolved.managementCredentialConflict, false);
});
