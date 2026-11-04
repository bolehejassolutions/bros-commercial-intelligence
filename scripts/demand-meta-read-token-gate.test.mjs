import test from "node:test";
import assert from "node:assert/strict";
import { isVerifiedDemandMetaReadTokenAudit } from "./demand-meta-preflight-gate.mjs";

test("read-token gate accepts authenticated exact-account readback only", () => {
  assert.equal(isVerifiedDemandMetaReadTokenAudit({ status: "CAPABILITY_READBACK", fixedAccountReadVerified: true }), true);
  for (const evidence of [null, undefined, [], {},
    { status: "MISSING_SERVER_CREDENTIAL", fixedAccountReadVerified: true },
    { status: "CAPABILITY_READBACK", fixedAccountReadVerified: false },
    { status: "CAPABILITY_READBACK", fixedAccountReadVerified: "true" },
    { status: "CAPABILITY_READBACK" }]) {
    assert.equal(isVerifiedDemandMetaReadTokenAudit(evidence), false);
  }
});

test("read-token gate fails closed for unreadable provider evidence", () => {
  const evidence = new Proxy({}, { get() { throw Error("provider failed"); } });
  assert.equal(isVerifiedDemandMetaReadTokenAudit(evidence), false);
});
