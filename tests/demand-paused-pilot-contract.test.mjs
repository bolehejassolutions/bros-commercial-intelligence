import test from "node:test";
import assert from "node:assert/strict";
import { APPROVED_DEMAND_META_PILOT as approved, assessPausedPilotReadback as assess } from "../scripts/demand-paused-pilot-contract.mjs";

const valid = () => ({ ...approved, effectiveStatus: "PAUSED", budgetRemainingMinor: 14000 });

test("exact approved paused readback is still unattested and cannot activate", () => {
  assert.deepEqual(assess(valid()), {
    status: "PAUSED_CANDIDATE_UNATTESTED",
    reason: "AUTHENTICATED_PROVIDER_READBACK_AND_PAID_PURCHASE_JOIN_REQUIRED",
    providerAuthenticated: false, paidPurchaseVerified: false, activationAllowed: false,
  });
});

test("rejects altered campaign, budget, audience, creatives and active state", () => {
  for (const [key,value] of [
    ["campaignId","different"], ["accountId","act_other"],
    ["lifetimeBudgetMinor",15000], ["durationDays",8],
    ["ageMin",18], ["ageMax",50], ["country","US"],
    ["creativeCount",3], ["status","ACTIVE"],
    ["effectiveStatus","ACTIVE"], ["budgetRemainingMinor",13999],
  ]) {
    const result = assess({...valid(),[key]:value});
    assert.equal(result.status,"BLOCKED",key);
    assert.equal(result.activationAllowed,false,key);
  }
});

test("unreadable provider-shaped objects fail closed", () => {
  assert.equal(assess(null).status,"BLOCKED");
  assert.equal(assess([]).status,"BLOCKED");
  assert.equal(assess(Object.create(null)).status,"BLOCKED");
  const accessor = valid();
  Object.defineProperty(accessor,"status",{get(){throw Error("secret");}});
  assert.equal(assess(accessor).reason,"UNREADABLE_READBACK");
});
