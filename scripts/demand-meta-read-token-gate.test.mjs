import test from "node:test";
import assert from "node:assert/strict";
import { isVerifiedDemandMetaReadTokenAudit } from "./demand-meta-preflight-gate.mjs";

const verified = () => ({
  status: "CAPABILITY_READBACK",
  fixedAccountReadVerified: true,
  credentialChanged: false,
  executionAllowed: false,
  accountCode: null,
  accountSubcode: null,
});

test("read-token gate accepts exact-account non-executable readback", () => {
  assert.equal(isVerifiedDemandMetaReadTokenAudit(verified()), true);
});

test("read-token gate rejects contradictory or incomplete provider evidence", () => {
  for (const change of [
    { executionAllowed: true }, { credentialChanged: true },
    { accountCode: 190 }, { accountSubcode: 12 },
    { fixedAccountReadVerified: false }, { status: "BLOCKED" },
    { executionAllowed: undefined }, { credentialChanged: undefined },
    { accountCode: undefined }, { accountSubcode: undefined },
  ]) assert.equal(isVerifiedDemandMetaReadTokenAudit({ ...verified(), ...change }), false,
    JSON.stringify(change));
  for (const value of [null, undefined, [], {}, "CAPABILITY_READBACK"])
    assert.equal(isVerifiedDemandMetaReadTokenAudit(value), false);
});

test("read-token gate fails closed for unreadable provider evidence", () => {
  const getter = { ...verified(), get accountCode() { throw Error("provider failed"); } };
  assert.equal(isVerifiedDemandMetaReadTokenAudit(getter), false);
  const revoked = Proxy.revocable(verified(), {});
  revoked.revoke();
  assert.equal(isVerifiedDemandMetaReadTokenAudit(revoked.proxy), false);
});
