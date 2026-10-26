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
