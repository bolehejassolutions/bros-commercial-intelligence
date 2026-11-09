import test from "node:test";
import assert from "node:assert/strict";
import { bindDemandCreativeForReview } from "../lib/demand/creative-plan-binding.ts";
const intake = {assetId:"asset:immutable:001",creativeVersion:"version:001",brandInstanceId:"brand:bros_sell",mediaSha256:"a".repeat(64),approvalEvidenceId:"approval:editorial:001",state:"INTAKE_VERIFIED_NOT_AD_APPROVED",metaUploadAllowed:false,campaignExecutionAllowed:false,admissionChecksApplied:true,membershipRecheckedAfterRead:true,approvalRecheckedAfterRead:true,approvalIndependentlyAttested:false};
const plan = {tenantId:"11111111-1111-4111-8111-111111111111",accountId:"act_1997776120879476",campaignPlanDigest:"b".repeat(64)};
const deny = /BROS_DEMAND_CREATIVE_BINDING_DENIED/;
test("deterministic review binding never grants Meta write permission",()=>{
  const a=bindDemandCreativeForReview(intake,plan), b=bindDemandCreativeForReview({...intake},{...plan});
  assert.deepEqual(a,b); assert.equal(a.state,"REVIEW_ONLY_NOT_AUTHORIZED");
  assert.equal(a.metaUploadAllowed,false); assert.equal(a.campaignExecutionAllowed,false);
  assert.equal(Object.isFrozen(a),true); assert.equal(JSON.stringify(a).includes(plan.tenantId),false);
});
test("creative, approval, tenant, account and plan substitutions alter binding",()=>{
  const original=bindDemandCreativeForReview(intake,plan).digest;
  for(const [i,p] of [[{...intake,assetId:"asset:immutable:002"},plan],[{...intake,creativeVersion:"version:002"},plan],[{...intake,mediaSha256:"c".repeat(64)},plan],[{...intake,approvalEvidenceId:"approval:editorial:002"},plan],[intake,{...plan,tenantId:"22222222-2222-4222-8222-222222222222"}],[intake,{...plan,accountId:"act_1997776120879477"}],[intake,{...plan,campaignPlanDigest:"c".repeat(64)}]])
    assert.notEqual(bindDemandCreativeForReview(i,p).digest,original);
});
test("forged grants, missing admission, malformed scope and extra fields fail closed",()=>{
  for(const [i,p] of [[{...intake,metaUploadAllowed:true},plan],[{...intake,campaignExecutionAllowed:true},plan],[{...intake,admissionChecksApplied:false},plan],[{...intake,approvalRecheckedAfterRead:false},plan],[{...intake,approvalIndependentlyAttested:true},plan],[intake,{...plan,tenantId:"other"}],[intake,{...plan,accountId:"123"}],[intake,{...plan,campaignPlanDigest:"bad"}],[intake,{...plan,ownerApproved:true}]])
    assert.throws(()=>bindDemandCreativeForReview(i,p),deny);
});

test("rejects unexpected creative permissions, prototype pollution and accessor attestations",()=> {
  assert.throws(()=>bindDemandCreativeForReview({...intake, providerApproved:true},plan),deny);
  assert.throws(()=>bindDemandCreativeForReview(Object.assign(Object.create(null),intake),plan),deny);
  assert.throws(()=>bindDemandCreativeForReview(intake,Object.assign(Object.create(null),plan)),deny);
  const accessor={...intake};
  Object.defineProperty(accessor,"admissionChecksApplied",{enumerable:true,get(){throw Error("getter executed");}});
  assert.throws(()=>bindDemandCreativeForReview(accessor,plan),deny);
  const planAccessor={...plan};
  Object.defineProperty(planAccessor,"accountId",{enumerable:true,get(){throw Error("getter executed");}});
  assert.throws(()=>bindDemandCreativeForReview(intake,planAccessor),deny);
});
