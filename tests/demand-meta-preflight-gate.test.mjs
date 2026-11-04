import test from "node:test";
import assert from "node:assert/strict";
import { isVerifiedDemandMetaManagementPreflight as verified } from "../scripts/demand-meta-preflight-gate.mjs";
const valid = () => ({ status: "READY", reason: "VERIFIED", mode: "write",
  accountId: "act_1997776120879476", businessPortfolioId: "2091328444802994",
  appId: "1315572270590189", checks: { token: true, app: true, account: true } });
test("only exact verified management identity passes", () => {
  assert.equal(verified(valid()), true);
  for (const [key, value] of Object.entries({status:"BLOCKED",reason:"TOKEN_INVALID",mode:"read",
    accountId:"act_0",businessPortfolioId:"0",appId:"0"})) {
    assert.equal(verified({...valid(),[key]:value}),false,key);
  }
  for (const check of ["token","app","account"]) {
    assert.equal(verified({...valid(),checks:{...valid().checks,[check]:false}}),false,check);
  }
});
test("malformed and throwing provider evidence fails closed", () => {
  for (const evidence of [null,undefined,[],false,{}, {status:"READY"},
    new Proxy({}, {get(){throw Error("unreadable");}})]) {
    assert.equal(verified(evidence),false);
  }
});
