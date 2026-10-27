import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeDemandConcurrentControl as propose } from '../lib/demand/concurrent-control-protocol.ts';

// Synthetic protocol only: no live allocation, campaign, approval, payment or conversion.
const valid = {
  tenantId: '11111111-1111-4111-8111-111111111111', product: 'demand',
  pilotProduct: 'bros_sell', metaAccountId: 'act_1997776120879476',
  campaignId: '120250828102660697',
  hypothesis: 'A clearer offer explanation could improve qualified purchase decisions.',
  action: 'LANDING_PAGE_TEST',
  treatmentChange: 'Explain the offer scope and one-off price more clearly.',
  primaryKpi: 'verified_paid_orders', plannedStart: '2026-10-29',
  plannedEnd: '2026-11-04', preRegisteredAt: '2026-10-27T07:00:00Z',
  evidenceCandidateIds: ['meta_ads:sha256:' + 'a'.repeat(64)],
  assignmentUnit: 'CONSENTED_LANDING_VISITOR',
  assignmentMethod: 'STICKY_RANDOM_50_50_PROPOSED',
  controlExperience: 'UNCHANGED_EXISTING_LANDING_PAGE',
  analysisPolicy: 'INTENTION_TO_TREAT', maxIncrementalSpendMinor: 0,
};
const invalid = /Invalid BROS DEMAND concurrent control protocol/;

test('proposed concurrent control is explicit, replayable and entirely unverified', () => {
  const x = propose(valid);
  assert.equal(x.experimentDesign, 'CONCURRENT_RANDOMIZED_HOLDOUT_PLAN_UNVERIFIED');
  assert.equal(x.status, 'PROPOSED_NOT_AUTHORIZED');
  assert.deepEqual(x.allocation, {controlPercent:50,treatmentPercent:50});
  for(const key of ['tenantAuthorizationVerified','preRegistrationAttested',
    'assignmentAndExposureVerified','concurrentControlVerified','providerEvidenceAttested',
    'actionApproved','actionExecuted','outcomeVerified','learningVerified',
    'controlledExperimentVerified','causalInferenceEligible','executionAllowed'])
    assert.equal(x[key],false,key);
  for(const key of ['verifiedPaidOrders','verifiedCacMinor','causalLift'])
    assert.equal(x[key],null,key);
  assert.equal(x.requiresOwnerApproval,true);
  assert.equal(x.maxIncrementalSpendMinor,0);
  assert.equal(x.noPricingChanges,true);
  assert.equal(x.noPublisherChanges,true);
  assert.ok(x.acceptanceEvidence.includes('authenticated_sticky_assignment_and_exposure_log_for_both_arms'));
  assert.ok(x.acceptanceEvidence.includes('durable_tenant_scoped_bci_outcome_and_learning_readback'));
  assert.ok(Object.isFrozen(x));
  assert.ok(Object.isFrozen(x.allocation));
  assert.ok(Object.isFrozen(x.evidenceCandidateIds));
  assert.ok(Object.isFrozen(x.acceptanceEvidence));
  assert.match(x.candidateId,/^demand:concurrent-control:sha256:[a-f0-9]{64}$/);
});

test('stable candidate independent of evidence order, sensitive to arms and scope',()=>{
  const other='hitpay:sha256:'+'b'.repeat(64);
  const a=propose({...valid,evidenceCandidateIds:[other,...valid.evidenceCandidateIds]});
  const b=propose({...valid,evidenceCandidateIds:[...valid.evidenceCandidateIds,other]});
  assert.equal(a.candidateId,b.candidateId);
  assert.notEqual(a.candidateId,propose(valid).candidateId);
  assert.notEqual(a.candidateId,propose({...valid,metaAccountId:'act_1997776120879477',
    evidenceCandidateIds:[other,...valid.evidenceCandidateIds]}).candidateId);
  assert.notEqual(a.candidateId,propose({...valid,treatmentChange:valid.treatmentChange+' Additional sentence.',
    evidenceCandidateIds:[other,...valid.evidenceCandidateIds]}).candidateId);
  const replay=propose({...a,evidenceCandidateIds:a.evidenceCandidateIds});
  assert.equal(replay.candidateId,a.candidateId);
});

test('cannot turn proposal into verified randomized outcome by caller assertions',()=>{
  const x=propose({...valid,actionApproved:true,actionExecuted:true,
    assignmentAndExposureVerified:true,controlledExperimentVerified:true,
    providerEvidenceAttested:true,causalInferenceEligible:true,
    verifiedPaidOrders:12,verifiedCacMinor:100,causalLift:0.9,
    status:'VERIFIED',executionAllowed:true,allocation:{controlPercent:0,treatmentPercent:100}});
  assert.equal(x.status,'PROPOSED_NOT_AUTHORIZED');
  assert.equal(x.actionApproved,false);
  assert.equal(x.controlledExperimentVerified,false);
  assert.equal(x.causalInferenceEligible,false);
  assert.equal(x.causalLift,null);
  assert.equal(x.executionAllowed,false);
  assert.equal(x.allocation.controlPercent,50);
});

test('rejects no control, alternate assignment, spend, tenant/product mismatch and unsafe evidence',()=>{
  for(const patch of [
    {controlExperience:'NO_CONTROL'}, {assignmentMethod:'FIRST_CLICK_WINS'},
    {assignmentUnit:'AD_ACCOUNT'}, {analysisPolicy:'PER_PROTOCOL'},
    {maxIncrementalSpendMinor:1},{maxIncrementalSpendMinor:-1},
    {product:'content'},{pilotProduct:'other'},
    {action:'CREATIVE_TEST'},{tenantId:'wrong'},{metaAccountId:'123'},
    {primaryKpi:'meta_attributed_purchases'},
    {evidenceCandidateIds:[]},
    {evidenceCandidateIds:[valid.evidenceCandidateIds[0],valid.evidenceCandidateIds[0]]},
    {evidenceCandidateIds:['<script>']},
  ]) assert.throws(()=>propose({...valid,...patch}),invalid);
});

test('rejects invalid and retrospective MYT window, including local midnight cutoff',()=>{
  const before=propose({...valid,preRegisteredAt:'2026-10-28T15:59:59Z'});
  assert.equal(before.status,'PROPOSED_NOT_AUTHORIZED');
  for(const patch of [
    {preRegisteredAt:'2026-10-28T16:00:00Z'},
    {preRegisteredAt:'2026-10-28T16:05:00Z'},
    {plannedEnd:'2026-10-28'}, {plannedStart:'2026-13-01'},
    {plannedStart:'2026-02-30'}, {plannedEnd:'2026-02-30'},
    {preRegisteredAt:'not a timestamp'},
  ]) assert.throws(()=>propose({...valid,...patch}),invalid);
});
