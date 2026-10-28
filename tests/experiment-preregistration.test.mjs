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
  assert.equal(x.experimentDesign, "SEQUENTIAL_BASELINE_NOT_CONTROLLED");
  assert.equal(x.controlledExperimentVerified, false);
  assert.equal(x.causalInferenceEligible, false);
  assert.equal(Object.isFrozen(x), true);
  assert.equal(Object.isFrozen(x.evidenceCandidateIds), true);
  assert.match(x.candidateId, /^demand:experiment:sha256:[a-f0-9]{64}$/);
});
test("sequential baseline cannot masquerade as a controlled experiment or causal proof", () => {
  const x = preregister({
    ...valid,
    experimentDesign: "RANDOMIZED_CONTROLLED",
    controlledExperimentVerified: true,
    causalInferenceEligible: true,
    controlGroupVerified: true,
    verifiedPaidOrders: 3,
    causalLift: 0.5,
  });
  assert.equal(x.experimentDesign, "SEQUENTIAL_BASELINE_NOT_CONTROLLED");
  assert.equal(x.controlledExperimentVerified, false);
  assert.equal(x.causalInferenceEligible, false);
  assert.equal(x.outcomeVerified, false);
  assert.equal(x.learningVerified, false);
  assert.equal(x.verifiedPaidOrders, null);
  assert.equal(x.causalLift, null);
  assert.equal(x.executionAllowed, false);
});

test("immutable proposal preserves full preregistered experiment protocol for independent replay", () => {
  const x = preregister({...valid,hypothesis:"  "+valid.hypothesis+"  "});
  assert.equal(x.metaAccountId,valid.metaAccountId);
  assert.equal(x.campaignId,valid.campaignId);
  assert.equal(x.hypothesis,valid.hypothesis);
  assert.equal(x.action,valid.action);
  assert.equal(x.primaryKpi,valid.primaryKpi);
  for (const field of ["baselineStart","baselineEnd","experimentStart","experimentEnd",
    "preRegisteredAt"]) assert.equal(x[field],valid[field],field);
  // A reviewer can replay the stable candidate from the returned object alone.
  const replay = preregister({
    tenantId:x.tenantId,product:x.product,pilotProduct:x.pilotProduct,
    metaAccountId:x.metaAccountId,campaignId:x.campaignId,
    hypothesis:x.hypothesis,action:x.action,primaryKpi:x.primaryKpi,
    baselineStart:x.baselineStart,baselineEnd:x.baselineEnd,
    experimentStart:x.experimentStart,experimentEnd:x.experimentEnd,
    preRegisteredAt:x.preRegisteredAt,evidenceCandidateIds:x.evidenceCandidateIds,
    maxIncrementalSpendMinor:x.maxIncrementalSpendMinor,
  });
  assert.equal(replay.candidateId,x.candidateId);
  assert.equal(x.actionApproved,false);
  assert.equal(x.outcomeVerified,false);
  assert.equal(x.learningVerified,false);
  assert.equal(x.executionAllowed,false);
  assert.equal(Object.isFrozen(x),true);
  assert.notEqual(x.candidateId,preregister({...valid,action:"CREATIVE_TEST"}).candidateId);
  assert.notEqual(x.candidateId,preregister({...valid,metaAccountId:"act_1997776120879477"}).candidateId);
  assert.notEqual(x.candidateId,preregister({...valid,baselineStart:"2026-10-02"}).candidateId);
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

test("MYT midnight preregistration cutoff accepts only before the local experiment starts", () => {
  // Experiment starts 28 Oct 00:00 MYT = 27 Oct 16:00 UTC.
  const before = preregister({...valid,preRegisteredAt:"2026-10-27T15:59:59Z"});
  assert.equal(before.status,"PROPOSED_NOT_AUTHORIZED");
  assert.equal(before.actionApproved,false);
  for(const preRegisteredAt of [
    "2026-10-27T16:00:00Z", // exact start
    "2026-10-27T16:05:00Z", // UTC still previous day; MYT already started
    "2026-10-28T00:01:00Z",
  ]) assert.throws(()=>preregister({...valid,preRegisteredAt}),invalid);
});

test("MYT year-rollover preregistration cutoff does not use UTC calendar date", () => {
  const nextYear={...valid,baselineStart:"2026-12-20",baselineEnd:"2026-12-30",
    experimentStart:"2027-01-01",experimentEnd:"2027-01-07",
    preRegisteredAt:"2026-12-31T15:59:59Z"};
  assert.equal(preregister(nextYear).status,"PROPOSED_NOT_AUTHORIZED");
  assert.throws(()=>preregister({...nextYear,preRegisteredAt:"2026-12-31T16:00:00Z"}),invalid);
});

test("reject coercible tenant, Meta account and campaign identities before proposal hashing", () => {
  const coercible = [
    {tenantId: [valid.tenantId]},
    {metaAccountId: [valid.metaAccountId]},
    {campaignId: [valid.campaignId]},
    {tenantId: {toString: () => valid.tenantId}},
    {metaAccountId: {toString: () => valid.metaAccountId}},
    {campaignId: {toString: () => valid.campaignId}},
    {tenantId: null}, {metaAccountId: null}, {campaignId: null},
    {tenantId: 1}, {metaAccountId: 1}, {campaignId: 1},
  ];
  for (const patch of coercible) {
    assert.throws(() => preregister({...valid, ...patch}), invalid);
  }
  // Valid replay remains stable and non-executable.
  const a = preregister(valid), b = preregister({...valid});
  assert.equal(a.candidateId, b.candidateId);
  assert.equal(a.actionApproved, false);
  assert.equal(a.executionAllowed, false);
  assert.equal(a.verifiedPaidOrders, null);
});
