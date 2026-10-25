import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDemandExperiment } from '../lib/bci/demand-experiment-review.ts';
const tenantId = '11111111-1111-4111-8111-111111111111';
const uuid = n => `${String(n).padStart(8,'0')}-2222-4222-8222-222222222222`;
const baseScope = {tenantId,product:'demand',windowStart:'2026-10-01T00:00:00Z',windowEnd:'2026-10-08T00:00:00Z'};
const afterScope = {...baseScope,windowStart:'2026-10-09T00:00:00Z',windowEnd:'2026-10-16T00:00:00Z'};
// Trusted adapter fixture: not a live provider attestation.
const summary = (scope, {leads=null,orders=null,spend=null}={}) => ({scope,qualifiedLeads:leads,
  settledOrders:orders,verifiedAdSpendMinor:spend});
const before = summary(baseScope,{leads:3});
const after = summary(afterScope,{leads:5});
const exp = {experimentId:uuid(1),tenantId,diagnosisId:uuid(2),decisionId:uuid(3),actionId:uuid(4),
  actionKind:'organic',approvalVerified:true,actionVerified:true,
  actionEffectiveAt:'2026-10-08T12:00:00Z',outcomeEvidenceId:'ga4-report-1',outcomeVerified:true,
  primaryMetric:'qualified_leads',maxVerifiedSpendMinor:null};
const denied = /invalid BROS DEMAND experiment review/i;

test('complete attested organic observation is not causal uplift or CPA',()=>{
  const r=reviewDemandExperiment(exp,before,after);
  assert.equal(r.status,'observed');assert.equal(r.observedDelta,2);
  assert.equal(r.observedChangeRatio,2/3);assert.equal(r.learning,'observed_increase');
  assert.equal(r.attribution,'observational_only');assert.equal(r.causalLift,null);
  assert.equal(r.cpaMinor,null);assert.equal(r.nextBestAction,'review_hypothesis');
});
test('unverified action or approval prevents completed observation',()=>{
  for(const patch of [{actionVerified:false},{approvalVerified:false}]){
    const r=reviewDemandExperiment({...exp,...patch},before,after);
    assert.equal(r.status,'action_unverified');assert.equal(r.observedDelta,null);
  }
});
test('missing or unverified provider outcome never counts as observed',()=>{
  for(const patch of [{outcomeEvidenceId:null},{outcomeVerified:false}]){
    assert.equal(reviewDemandExperiment({...exp,...patch},before,after).status,'outcome_unverified');
  }
});
test('zero is observed but missing baseline or observed count is unknown',()=>{
  const zero=summary(afterScope,{leads:0});
  assert.equal(reviewDemandExperiment(exp,before,zero).learning,'observed_decrease');
  assert.equal(reviewDemandExperiment(exp,summary(baseScope),after).status,'metric_unavailable');
  const fromZero=reviewDemandExperiment(exp,summary(baseScope,{leads:0}),after);
  assert.equal(fromZero.observedDelta,5);assert.equal(fromZero.observedChangeRatio,null);
});
test('paid experiments need verified spend and explicit cap',()=>{
  const paid={...exp,actionKind:'paid',maxVerifiedSpendMinor:3000};
  assert.equal(reviewDemandExperiment(paid,before,after).status,'spend_unverified');
  const within=summary(afterScope,{leads:5,spend:3000});
  assert.equal(reviewDemandExperiment(paid,before,within).status,'observed');
  const over=summary(afterScope,{leads:5,spend:3001});
  assert.equal(reviewDemandExperiment(paid,before,over).status,'guardrail_exceeded');
  assert.equal(reviewDemandExperiment(paid,before,over).observedDelta,null);
  assert.equal(reviewDemandExperiment({...paid,outcomeVerified:false},before,over).status,'guardrail_exceeded');
  assert.throws(()=>reviewDemandExperiment({...paid,maxVerifiedSpendMinor:null},before,within),denied);
});
test('cross tenant/product and overlapping windows are rejected',()=>{
  assert.throws(()=>reviewDemandExperiment({...exp,tenantId:uuid(9)},before,after),denied);
  const content=summary({...afterScope,product:'content'});
  assert.throws(()=>reviewDemandExperiment(exp,before,content),denied);
  const overlapping=summary({...afterScope,windowStart:'2026-10-07T00:00:00Z'});
  assert.throws(()=>reviewDemandExperiment(exp,before,overlapping),denied);
});
test('invalid time, identity, attestation and numeric inputs fail closed',()=>{
  for(const patch of [{experimentId:'x'},{diagnosisId:'x'},{actionEffectiveAt:'2026-02-31T00:00:00Z'},
    {outcomeEvidenceId:' '},{outcomeVerified:'yes'},{maxVerifiedSpendMinor:-1},{maxVerifiedSpendMinor:1.2}])
    assert.throws(()=>reviewDemandExperiment({...exp,...patch},before,after),denied);
});
test('settled order metric requires actual verified settled-order evidence, not Meta events',()=>{
  const platformOnly=summary(afterScope);
  const r=reviewDemandExperiment({...exp,primaryMetric:'settled_orders'},summary(baseScope),platformOnly);
  assert.equal(r.status,'metric_unavailable');assert.equal(r.observedDelta,null);
});
