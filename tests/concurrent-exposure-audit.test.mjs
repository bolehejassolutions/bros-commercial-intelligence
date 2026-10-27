import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDemandConcurrentExposureCandidates as audit } from '../lib/demand/concurrent-exposure-audit.ts';
import { proposeDemandConcurrentControl as propose } from '../lib/demand/concurrent-control-protocol.ts';
const tenantId = '11111111-1111-4111-8111-111111111111';
// Synthetic but replayable protocol, not an authenticated registration or real exposure.
const proposal = propose({
  tenantId, product:'demand', pilotProduct:'bros_sell',
  metaAccountId:'act_1997776120879476', campaignId:'120250828102660697',
  hypothesis:'A clearer offer explanation could improve qualified purchase decisions.',
  action:'LANDING_PAGE_TEST',
  treatmentChange:'Explain the offer scope and one-off price more clearly.',
  primaryKpi:'verified_paid_orders', plannedStart:'2026-10-29', plannedEnd:'2026-11-04',
  preRegisteredAt:'2026-10-27T07:00:00Z',
  evidenceCandidateIds:['meta_ads:sha256:'+'a'.repeat(64)],
  assignmentUnit:'CONSENTED_LANDING_VISITOR',
  assignmentMethod:'STICKY_RANDOM_50_50_PROPOSED',
  controlExperience:'UNCHANGED_EXISTING_LANDING_PAGE',
  analysisPolicy:'INTENTION_TO_TREAT', maxIncrementalSpendMinor:0,
});
const id = proposal.candidateId;
const a = 'a'.repeat(64), b = 'b'.repeat(64);
const ev = (eventId,visitorDigest,kind,arm,patch={})=>({eventId,experimentCandidateId:id,
  tenantId,product:'demand',visitorDigest,kind,arm,observedAt:'2026-10-29T04:00:00Z',
  consentRecorded:true,...patch});
const valid=[ev('assign:a',a,'assignment','control'),ev('expose:a',a,'exposure','control'),
  ev('assign:b',b,'assignment','treatment'),ev('expose:b',b,'exposure','treatment')];

test('consistent synthetic assignments stay unverified, with stable replay and no conversion claim',()=>{
  const x=audit(proposal,valid), y=audit(proposal,[...valid].reverse());
  assert.equal(x.candidateId,y.candidateId);
  assert.equal(x.structuralConsistency,true);
  assert.deepEqual(x.findings,[]);
  assert.deepEqual([x.controlAssignments,x.treatmentAssignments,x.controlExposures,x.treatmentExposures],[1,1,1,1]);
  for(const k of ['assignmentRandomnessVerified','providerEvidenceAttested','consentIndependentlyVerified',
    'ownerApprovalVerified','experimentExecutedVerified','outcomeVerified','learningVerified',
    'causalInferenceEligible','executionAllowed']) assert.equal(x[k],false,k);
  for(const k of ['verifiedPaidOrders','verifiedCacMinor','causalLift']) assert.equal(x[k],null,k);
  assert.ok(Object.isFrozen(x));assert.ok(Object.isFrozen(x.findings));
});

test('cross-arm contamination and missing assignment are explicitly detected',()=>{
  const x=audit(proposal,[valid[0],ev('expose:a',a,'exposure','treatment'),
    ev('expose:b',b,'exposure','treatment')]);
  assert.equal(x.structuralConsistency,false);
  assert.ok(x.findings.includes('CROSS_ARM_CONTAMINATION'));
  assert.ok(x.findings.includes('EXPOSURE_WITHOUT_ASSIGNMENT'));
  assert.ok(x.findings.includes('BOTH_ARMS_NOT_OBSERVED'));
});

test('exposure before assignment cannot pass chronological review',()=>{
  const x=audit(proposal,[ev('assign:a',a,'assignment','control',
    {observedAt:'2026-10-29T05:00:00Z'}),valid[1],valid[2],valid[3]]);
  assert.equal(x.structuralConsistency,false);
  assert.ok(x.findings.includes('EXPOSURE_BEFORE_ASSIGNMENT'));
});

test('no consent, duplicate visitors, missing exposure and out-of-window events fail structural review',()=>{
  const x=audit(proposal,[valid[0],valid[2],ev('assign:other',a,'assignment','control'),
    ev('expose:b',b,'exposure','treatment',{consentRecorded:false,
      observedAt:'2026-10-28T15:59:59Z'})]);
  for(const f of ['CONSENT_NOT_RECORDED','DUPLICATE_VISITOR_ASSIGNMENT',
    'EVENT_OUTSIDE_PREREGISTERED_WINDOW','ASSIGNED_WITHOUT_EXPOSURE'])
    assert.ok(x.findings.includes(f),f);
  assert.equal(x.structuralConsistency,false);
});

test('rejects forged scope, duplicate event ID, raw visitor IDs and malformed timestamps',()=>{
  const invalid = /Invalid BROS DEMAND concurrent exposure candidates/;
  for(const patch of [{tenantId:'other'},{product:'content'},{experimentCandidateId:'other'},
    {visitorDigest:'email@example.com'},{observedAt:'2026-10-29T24:00:00Z'},
    {consentRecorded:'yes'},{kind:'payment'},{arm:'other'}])
    assert.throws(()=>audit(proposal,[ev('assign:a',a,'assignment','control',patch)]),invalid);
  assert.throws(()=>audit(proposal,[valid[0],valid[0]]),invalid);
  assert.throws(()=>audit({...proposal,product:'content'},valid),invalid);
});


test('rejects plausible-looking forged protocol IDs, scope, design and caller truthy claims',()=>{
  const invalid=/Invalid BROS DEMAND concurrent exposure candidates/;
  for(const patch of [
    {candidateId:'demand:concurrent-control:sha256:'+'f'.repeat(64)},
    {hypothesis:proposal.hypothesis+' Tampered.'},
    {treatmentChange:proposal.treatmentChange+' Changed.'},
    {plannedEnd:'2026-11-05'},
    {preRegisteredAt:'2026-10-29T00:00:00Z'},
    {allocation:{controlPercent:100,treatmentPercent:0}},
    {actionApproved:true},{actionExecuted:true},{outcomeVerified:true},
    {learningVerified:true},{tenantAuthorizationVerified:true},
    {verifiedPaidOrders:1},{causalLift:0.5},
    {concurrentControlVerified:true},{controlledExperimentVerified:true},
    {requiresOwnerApproval:false},{noPricingChanges:false},
    {noPublisherChanges:false},{maxIncrementalSpendMinor:100},
    {acceptanceEvidence:[]},{acceptanceEvidence:[...proposal.acceptanceEvidence].reverse()},
    {evidenceCandidateIds:[]},{unexpectedVerificationFlag:true},
  ]) assert.throws(()=>audit({...proposal,...patch},valid),invalid);
});

test('complete protocol guard also blocks forged downstream order-join readiness',async()=>{
  const {auditDemandOrderExposureCandidates:orderAudit}=
    await import('../lib/demand/concurrent-order-candidate-audit.ts');
  const invalid=/Invalid BROS DEMAND order exposure candidates/;
  for(const patch of [{concurrentControlVerified:true},{controlledExperimentVerified:true},
    {requiresOwnerApproval:false},{noPricingChanges:false},
    {noPublisherChanges:false},{acceptanceEvidence:[]},
    {maxIncrementalSpendMinor:1},{unexpectedVerificationFlag:true}])
    assert.throws(()=>orderAudit({...proposal,...patch},valid,[]),invalid);
});
