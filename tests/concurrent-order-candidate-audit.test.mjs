import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDemandOrderExposureCandidates as audit } from '../lib/demand/concurrent-order-candidate-audit.ts';
import { proposeDemandConcurrentControl as propose } from '../lib/demand/concurrent-control-protocol.ts';
const tenantId='11111111-1111-4111-8111-111111111111';
const protocol=propose({tenantId,product:'demand',pilotProduct:'bros_sell',
  metaAccountId:'act_1997776120879476',campaignId:'120250828102660697',
  hypothesis:'A clearer offer explanation could improve qualified purchase decisions.',
  action:'LANDING_PAGE_TEST',treatmentChange:'Explain the offer scope and one-off price more clearly.',
  primaryKpi:'verified_paid_orders',plannedStart:'2026-10-29',plannedEnd:'2026-11-04',
  preRegisteredAt:'2026-10-27T07:00:00Z',
  evidenceCandidateIds:['meta_ads:sha256:'+'a'.repeat(64)],
  assignmentUnit:'CONSENTED_LANDING_VISITOR',
  assignmentMethod:'STICKY_RANDOM_50_50_PROPOSED',
  controlExperience:'UNCHANGED_EXISTING_LANDING_PAGE',analysisPolicy:'INTENTION_TO_TREAT',
  maxIncrementalSpendMinor:0});
const a='a'.repeat(64),b='b'.repeat(64);
const exposure=(eventId,visitorDigest,kind,arm,patch={})=>({eventId,
  experimentCandidateId:protocol.candidateId,tenantId,product:'demand',
  visitorDigest,kind,arm,observedAt:'2026-10-29T04:00:00Z',consentRecorded:true,...patch});
const events=[exposure('assign:a',a,'assignment','control'),
  exposure('expose:a',a,'exposure','control'),
  exposure('assign:b',b,'assignment','treatment'),
  exposure('expose:b',b,'exposure','treatment')];
const order=(eventId,visitorDigest,arm,orderDigest,patch={})=>({eventId,
  experimentCandidateId:protocol.candidateId,tenantId,product:'demand',pilotProduct:'bros_sell',
  visitorDigest,orderCandidateKey:'demand:hitpay-candidate:sha256:'+orderDigest,
  arm,observedAt:'2026-10-29T06:00:00Z',...patch});
const orders=[order('checkout:a',a,'control','c'.repeat(64)),
  order('checkout:b',b,'treatment','d'.repeat(64))];

test('untrusted order join is replay-stable, never paid/settled/attributed',()=>{
  const x=audit(protocol,events,orders), y=audit(protocol,[...events].reverse(),[...orders].reverse());
  assert.equal(x.candidateId,y.candidateId);
  assert.equal(x.structuralConsistency,true);
  assert.deepEqual(x.findings,[]);
  assert.deepEqual([x.controlOrderCandidates,x.treatmentOrderCandidates],[1,1]);
  assert.equal(x.status,'UNATTESTED_ORDER_EXPOSURE_JOIN');
  for(const k of ['providerAuthenticationVerified','tenantMembershipVerified',
    'randomizedAssignmentVerified','consentIndependentlyVerified','ownerApprovalVerified',
    'actionExecutedVerified','hitpayLiveEnvironmentVerified','hitpaySettlementVerified',
    'entitlementVerified','attributionVerified','outcomeVerified','learningVerified',
    'causalInferenceEligible','executionAllowed']) assert.equal(x[k],false,k);
  for(const k of ['verifiedPaidOrders','settledOrders','verifiedConversionRate',
    'verifiedCacMinor','causalLift']) assert.equal(x[k],null,k);
  assert.ok(Object.isFrozen(x)); assert.ok(Object.isFrozen(x.findings));
});
test('duplicate order across arms is not two verified conversions',()=>{
  const x=audit(protocol,events,[orders[0],order('checkout:b',b,'treatment','c'.repeat(64))]);
  assert.equal(x.structuralConsistency,false);
  assert.ok(x.findings.includes('DUPLICATE_ORDER_CANDIDATE'));
  assert.equal(x.verifiedPaidOrders,null);
});
test('wrong arm, no exposure and pre-exposure candidate cannot be attributed',()=>{
  const x=audit(protocol,events,[order('checkout:a',a,'treatment','e'.repeat(64),
    {observedAt:'2026-10-29T03:00:00Z'}),
    order('checkout:z','f'.repeat(64),'control','f'.repeat(64))]);
  for(const finding of ['ORDER_CANDIDATE_CROSS_ARM','ORDER_CANDIDATE_BEFORE_EXPOSURE',
    'ORDER_CANDIDATE_WITHOUT_EXPOSURE']) assert.ok(x.findings.includes(finding),finding);
  assert.equal(x.structuralConsistency,false);
});
test('no orders, missing consent and post-window candidates require review',()=>{
  assert.ok(audit(protocol,events,[]).findings.includes('NO_ORDER_CANDIDATES_OBSERVED'));
  const badEvents=[...events.slice(0,3),exposure('expose:b',b,'exposure','treatment',
    {consentRecorded:false})];
  const x=audit(protocol,badEvents,[order('checkout:b',b,'treatment','e'.repeat(64),
    {observedAt:'2026-11-05T12:00:00Z'})]);
  for(const finding of ['EXPOSURE_AUDIT_NOT_STRUCTURALLY_CONSISTENT',
    'EXPOSURE_CONSENT_NOT_RECORDED',
    'ORDER_CANDIDATE_OUTSIDE_EXPERIMENT_WINDOW_REVIEW_REQUIRED'])
    assert.ok(x.findings.includes(finding),finding);
});
test('rejects raw IDs, forged scope, duplicate event IDs and tampered protocol',()=>{
  const invalid=/Invalid BROS DEMAND order exposure candidates/;
  for(const patch of [{tenantId:'another-tenant'},{product:'content'},
    {pilotProduct:'other'},{experimentCandidateId:'forged'},
    {visitorDigest:'person@example.com'},{orderCandidateKey:'Order #1007'},
    {observedAt:'2026-10-29T24:00:00Z'},{arm:'neither'}])
    assert.throws(()=>audit(protocol,events,[{...orders[0],...patch}]),invalid);
  assert.throws(()=>audit(protocol,events,[orders[0],orders[0]]),invalid);
  assert.throws(()=>audit({...protocol,treatmentChange:'forged treatment'},events,orders),invalid);
  assert.throws(()=>audit({...protocol,actionApproved:true},events,orders),invalid);
});
