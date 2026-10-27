import test from "node:test";
import assert from "node:assert/strict";
import { preregisterDemandExperiment as preregister } from "../lib/demand/experiment-preregistration.ts";

// Synthetic scope/IDs. These tests do NOT attest Meta/HitPay, authorize an ad, or create an experiment.
const valid = {
  tenantId: "11111111-1111-4111-8111-111111111111", product: "demand",
  pilotProduct: "bros_sell", metaAccountId: "act_1997776120879476",
  campaignId: "120250828102660697",
  hypothesis: "Clarifying the offer on the landing page may improve qualified decisions.",
  action: "LANDING_PAGE_TEST", primaryKpi: "verified_paid_orders",
  baselineStart: "2026-10-01", baselineEnd: "2026-10-07",
  experimentStart: "2026-10-28", experimentEnd: "2026-11-03",
  preRegisteredAt: "2026-10-27T03:00:00Z",
  evidenceCandidateIds: ["meta_ads:sha256:"+"a".repeat(64)],
  maxIncrementalSpendMinor: 0,
};
const invalid = /Invalid BROS DEMAND experiment preregistration/;
test("preregistration is explicitly non-executable, with no verified business outcomes", () => {
  const x = preregister(valid);
  assert.equal(x.status, "PROPOSED_NOT_AUTHORIZED");
  for (const key of ["providerEvidenceAttested", "tenantAuthorizationVerified",
    "actionApproved", "actionExecuted", "outcomeVerified", "learningVerified",
    "executionAllowed"]) assert.equal(x[key], false, key);
  for (const key of ["verifiedPaidOrders", "verifiedCacMinor", "causalLift"])
    assert.equal(x[key], null, key);
  assert.equal(x.requiresOwnerApproval, true);
  assert.equal(x.maxIncrementalSpendMinor, 0);
  assert.equal(x.noPricingChanges, true);
  assert.equal(x.noPublisherChanges, true);
  assert.equal(Object.isFrozen(x), true);
  assert.equal(Object.isFrozen(x.evidenceCandidateIds), true);
  assert.match(x.candidateId, /^demand:experiment:sha256:[a-f0-9]{64}$/);
});
test("stable identity is independent of evidence order, but changes on hypothesis, window and evidence", () => {
  const other = "ga4:sha256:"+"b".repeat(64);
  const a = preregister({...valid, evidenceCandidateIds:[other,...valid.evidenceCandidateIds]});
  const b = preregister({...valid, evidenceCandidateIds:[...valid.evidenceCandidateIds,other]});
  assert.equal(a.candidateId,b.candidateId);
  assert.notEqual(a.candidateId,preregister({...valid,hypothesis:valid.hypothesis+" New."}).candidateId);
  assert.notEqual(a.candidateId,preregister({...valid,experimentEnd:"2026-11-04",
    evidenceCandidateIds:[other,...valid.evidenceCandidateIds]}).candidateId);
  assert.notEqual(a.candidateId,preregister(valid).candidateId);
});
test("reject unapproved spend and attempts to masquerade as another product", () => {
  for(const patch of [{maxIncrementalSpendMinor:1},{maxIncrementalSpendMinor:-1},
    {product:"content"},{pilotProduct:"other"},{metaAccountId:"123"},
    {tenantId:"not-a-uuid"}]) assert.throws(()=>preregister({...valid,...patch}),invalid);
});
test("reject retrospective or overlapping experiment windows", () => {
  for(const patch of [{baselineEnd:"2026-10-28"},{experimentEnd:"2026-10-27"},
    {experimentStart:"2026-10-05"},{preRegisteredAt:"2026-11-01T00:00:00Z"},
    {baselineStart:"2026-02-30"},{experimentEnd:"2026-13-01"}])
    assert.throws(()=>preregister({...valid,...patch}),invalid);
});
test("reject missing, duplicate, unsafe and excessive evidence candidates", () => {
  for(const evidenceCandidateIds of [[],[valid.evidenceCandidateIds[0],valid.evidenceCandidateIds[0]],
    ["not ok"],["<script>"],Array.from({length:21},(_,i)=>"candidate_"+i.toString().padStart(4,"0"))])
    assert.throws(()=>preregister({...valid,evidenceCandidateIds}),invalid);
});
test("no caller-supplied attestation or approval fields can upgrade proposal state", () => {
  const x = preregister({...valid,actionApproved:true,outcomeVerified:true,
    providerEvidenceAttested:true,verifiedPaidOrders:100,causalLift:1});
  assert.equal(x.actionApproved,false);
  assert.equal(x.outcomeVerified,false);
  assert.equal(x.providerEvidenceAttested,false);
  assert.equal(x.verifiedPaidOrders,null);
  assert.equal(x.causalLift,null);
});
