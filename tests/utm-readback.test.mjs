import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeDemandPilotUtm } from '../lib/demand/utm-experiment.ts';
import { assessDemandUtmReadback } from '../lib/demand/utm-readback.ts';

const proposal=proposeDemandPilotUtm({experimentId:'demand_sell_decision_state_v1',channel:'instagram',variant:'a',landingUrl:'https://bros.bolehejas.com/'});
const row={reportId:'ga4report_20261026_01',propertyId:'properties/12345678',retrievedAt:'2026-10-26T13:15:00Z',periodStart:'2026-10-25',periodEnd:'2026-10-26',landingPath:'/',source:'instagram',medium:'organic_social',campaign:'demand_sell_decision_state_v1',content:'a',sessions:5,engagedSessions:2};
const invalid=/Invalid BROS DEMAND UTM readback/;

test('missing provider row is unknown, never fabricated zero or proof',()=>{
  const x=assessDemandUtmReadback(proposal,null);
  assert.equal(x.status,'NO_READBACK');
  assert.equal(x.unattestedSessions,null);
  assert.equal(x.candidateReportCorrelationKey,null);
  assert.equal(x.utmCaptureVerified,false);
});
test('exact-match candidate is stable but cannot self-attest provider, tenant or checkout',()=>{
  const x=assessDemandUtmReadback(proposal,row);
  assert.deepEqual(x,assessDemandUtmReadback(proposal,{...row}));
  assert.equal(x.status,'MATCHED_UNATTESTED');
  assert.match(x.candidateReportCorrelationKey,/^demand:utm-candidate:/);
  assert.equal(x.unattestedSessions,5);
  for(const k of ['providerAuthenticationVerified','tenantMembershipVerified','utmCaptureVerified','checkoutAttributionVerified']) assert.equal(x[k],false);
  for(const k of ['qualifiedLeads','settledOrders','verifiedCacMinor','causalLift']) assert.equal(x[k],null);
  assert.ok(Object.isFrozen(x));
});
test('explicit provider zero stays zero but is not a verified conversion',()=>{
  const x=assessDemandUtmReadback(proposal,{...row,sessions:0,engagedSessions:0});
  assert.equal(x.unattestedSessions,0);
  assert.equal(x.settledOrders,null);
});
test('different campaign, variant, channel, medium or landing path rejects without leaking metrics',()=>{
  for(const patch of [{campaign:'other'},{content:'b'},{source:'tiktok'},{medium:'paid_social'},{landingPath:'/checkout'}]) {
    const x=assessDemandUtmReadback(proposal,{...row,...patch});
    assert.equal(x.status,'REJECTED_SCOPE');
    assert.equal(x.candidateReportCorrelationKey,null);
    assert.equal(x.unattestedSessions,null);
  }
});
test('malformed report, impossible date, future window and bad metrics fail closed',()=>{
  for(const patch of [
    {reportId:'bad/id'}, {reportId:'pii@example.com'}, {propertyId:'properties/0'},
    {retrievedAt:'2026-10-26T13:15:00+08:00'},
    {retrievedAt:'invalid'}, {periodStart:'2026-02-30'},
    {periodStart:'2026-10-27'}, {periodEnd:'2026-10-27'},
    {sessions:-1}, {sessions:1.5}, {sessions:Infinity},
    {sessions:1,engagedSessions:2}, {engagedSessions:-1}
  ]) assert.throws(()=>assessDemandUtmReadback(proposal,{...row,...patch}),invalid);
});
test('no authority to execute, publish or claim actual acquisition outcome',()=>{
  const x=assessDemandUtmReadback(proposal,row);
  assert.equal('publish' in x,false);
  assert.equal('execute' in x,false);
  assert.equal('paidOrders' in x,false);
  assert.equal('verifiedRevenue' in x,false);
});


test('proposal identity is immutable across channel, variant, campaign and missing readback',()=>{
  const bad=[
    {...proposal,proposalId:'demand:utm:another:instagram:a'},
    {...proposal,proposalId:'demand:utm:demand_sell_decision_state_v1:instagram:b'},
    {...proposal,channel:'facebook'},
    {...proposal,variant:'b'},
    {...proposal,experimentId:'another_experiment'},
    {...proposal,experimentId:'invalid/campaign'},
    {...proposal,proposalId:'demand:utm:fake'},
  ];
  for(const spoof of bad){
    assert.throws(()=>assessDemandUtmReadback(spoof,row),invalid);
    assert.throws(()=>assessDemandUtmReadback(spoof,null),invalid);
  }
});
test('URL userinfo and fragments cannot alias a canonical proposal ID',()=>{
  for(const taggedUrl of [
    proposal.taggedUrl+'#other',
    proposal.taggedUrl.replace('https://','https://user:pass@'),
    proposal.taggedUrl+'&utm_medium=paid_social',
    proposal.taggedUrl.replace('bros.bolehejas.com','evil.example'),
  ]) assert.throws(()=>assessDemandUtmReadback({...proposal,taggedUrl},row),invalid);
});


test('MYT midnight permits current local GA4 report day while UTC date is previous',()=>{
  const early={...row,reportId:'ga4report_20261027_01',
    retrievedAt:'2026-10-26T16:05:00Z',periodStart:'2026-10-27',
    periodEnd:'2026-10-27'};
  const result=assessDemandUtmReadback(proposal,early);
  assert.equal(result.status,'MATCHED_UNATTESTED');
  assert.equal(result.utmCaptureVerified,false);
  assert.equal(result.checkoutAttributionVerified,false);
  assert.equal(result.settledOrders,null);
});

test('MYT boundary rejects report periods that have not started locally',()=>{
  const future={...row,reportId:'ga4report_20261027_02',
    retrievedAt:'2026-10-26T15:59:59Z',periodStart:'2026-10-27',
    periodEnd:'2026-10-27'};
  assert.throws(()=>assessDemandUtmReadback(proposal,future),invalid);
});

test('MYT year rollover keeps the correct local GA4 reporting date',()=>{
  const rollover={...row,reportId:'ga4report_20270101_01',
    retrievedAt:'2026-12-31T16:01:00Z',periodStart:'2027-01-01',
    periodEnd:'2027-01-01'};
  assert.equal(assessDemandUtmReadback(proposal,rollover).status,'MATCHED_UNATTESTED');
});

test('GA4 candidate identity scopes report ID by property and date window without claiming verification',()=>{
  const base=assessDemandUtmReadback(proposal,row);
  const differentProperty=assessDemandUtmReadback(proposal,{...row,propertyId:'properties/87654321'});
  const differentWindow=assessDemandUtmReadback(proposal,{...row,periodStart:'2026-10-24'});
  assert.equal(base.status,'MATCHED_UNATTESTED');
  assert.equal(differentProperty.status,'MATCHED_UNATTESTED');
  assert.equal(differentWindow.status,'MATCHED_UNATTESTED');
  assert.notEqual(base.candidateReportCorrelationKey,differentProperty.candidateReportCorrelationKey);
  assert.notEqual(base.candidateReportCorrelationKey,differentWindow.candidateReportCorrelationKey);
  assert.equal(base.candidateReportCorrelationKey,
    assessDemandUtmReadback(proposal,{...row}).candidateReportCorrelationKey);
  for(const x of [base,differentProperty,differentWindow]){
    assert.equal(x.providerAuthenticationVerified,false);
    assert.equal(x.tenantMembershipVerified,false);
    assert.equal(x.utmCaptureVerified,false);
    assert.equal(x.checkoutAttributionVerified,false);
    assert.equal(x.settledOrders,null);
    assert.equal(x.verifiedCacMinor,null);
    assert.equal(x.causalLift,null);
  }
});

test('GA4 repeated collection is idempotent; revised metrics or report lineage change identity',()=>{
  const first=assessDemandUtmReadback(proposal,row);
  const later=assessDemandUtmReadback(proposal,{...row,retrievedAt:'2026-10-26T14:15:00Z'});
  const revised=assessDemandUtmReadback(proposal,{...row,sessions:6,engagedSessions:3});
  const differentReport=assessDemandUtmReadback(proposal,{...row,reportId:'ga4report_20261026_02'});
  const missing=assessDemandUtmReadback(proposal,{...row,sessions:null,engagedSessions:null});
  const reportedZero=assessDemandUtmReadback(proposal,{...row,sessions:0,engagedSessions:0});
  assert.equal(first.candidateReportCorrelationKey,later.candidateReportCorrelationKey);
  const keys=[first,revised,differentReport,missing,reportedZero].map(x=>x.candidateReportCorrelationKey);
  assert.equal(new Set(keys).size,keys.length);
  assert.match(first.candidateReportCorrelationKey,/^demand:utm-candidate:.*:sha256:[a-f0-9]{64}$/);
  assert.equal(first.candidateReportCorrelationKey,
    assessDemandUtmReadback(proposal,{...row}).candidateReportCorrelationKey);
  for(const x of [first,later,revised,differentReport,missing,reportedZero]){
    assert.equal(x.status,'MATCHED_UNATTESTED');
    assert.equal(x.providerAuthenticationVerified,false);
    assert.equal(x.tenantMembershipVerified,false);
    assert.equal(x.utmCaptureVerified,false);
    assert.equal(x.checkoutAttributionVerified,false);
    assert.equal(x.qualifiedLeads,null);
    assert.equal(x.settledOrders,null);
    assert.equal(x.verifiedCacMinor,null);
    assert.equal(x.causalLift,null);
  }
});

test('GA4 readback rejects coercible identifiers and normalized impossible UTC timestamps',()=>{
  for(const patch of [
    {reportId:[row.reportId]},
    {propertyId:[row.propertyId]},
    {periodStart:[row.periodStart]},
    {periodEnd:[row.periodEnd]},
    {retrievedAt:'2026-10-26T24:00:00Z'},
    {retrievedAt:'2026-02-30T13:15:00Z'},
    {retrievedAt:'2026-10-26T13:60:00Z'},
  ]) assert.throws(()=>assessDemandUtmReadback(proposal,{...row,...patch}),invalid);
  // Valid milliseconds remain allowed, but neither an untrusted GA4 row nor
  // its stable candidate key becomes provider-authenticated purchase proof.
  const fractional=assessDemandUtmReadback(proposal,{
    ...row,retrievedAt:'2026-10-26T13:15:00.12Z'});
  assert.equal(fractional.status,'MATCHED_UNATTESTED');
  assert.equal(fractional.candidateReportCorrelationKey,
    assessDemandUtmReadback(proposal,row).candidateReportCorrelationKey);
  assert.equal(fractional.providerAuthenticationVerified,false);
  assert.equal(fractional.checkoutAttributionVerified,false);
  assert.equal(fractional.settledOrders,null);
  assert.equal(fractional.verifiedCacMinor,null);
});

test('forged UTM proposal verification claims fail before GA4 readback',()=>{
  // A valid-looking proposal ID and tagged URL do not attest consent,
  // provider capture, conversion, settlement or authorization.
  const reordered=new URL(proposal.taggedUrl);
  reordered.searchParams.sort();
  const {providerOutcomeVerified: _omitted, ...missingField}=proposal;
  const attempts=[
    {...proposal,utmCaptureVerified:true},
    {...proposal,checkoutAttributionVerified:true},
    {...proposal,providerOutcomeVerified:true},
    {...proposal,qualifiedLeads:1},
    {...proposal,settledOrders:1},
    {...proposal,verifiedCacMinor:0},
    {...proposal,causalLift:0.25},
    {...proposal,ownerApproved:true},
    {...proposal,status:'VERIFIED'},
    {...proposal,taggedUrl:reordered.toString()},
    {...proposal,unexpectedProviderCredential:'must-not-pass'},
    missingField,
  ];
  for(const forged of attempts){
    assert.throws(()=>assessDemandUtmReadback(forged,row),invalid);
    assert.throws(()=>assessDemandUtmReadback(forged,null),invalid);
  }
  const legitimate=assessDemandUtmReadback(proposal,row);
  assert.equal(legitimate.status,'MATCHED_UNATTESTED');
  assert.equal(legitimate.settledOrders,null);
  assert.equal(legitimate.providerAuthenticationVerified,false);
});
