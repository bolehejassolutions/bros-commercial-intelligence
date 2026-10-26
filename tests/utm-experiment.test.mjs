import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeDemandPilotUtm } from '../lib/demand/utm-experiment.ts';

const base = {experimentId:'demand_sell_decision_state_v1',
  channel:'instagram',variant:'a',landingUrl:'https://bros.bolehejas.com/'};
const invalid=/Invalid BROS DEMAND UTM proposal/;

test('generates deterministic source-bound proposal and exact UTM keys',()=>{
  const a=proposeDemandPilotUtm(base);
  const b=proposeDemandPilotUtm({...base});
  assert.deepEqual(a,b);
  assert.equal(a.proposalId,'demand:utm:demand_sell_decision_state_v1:instagram:a');
  const url=new URL(a.taggedUrl);
  assert.equal(url.origin,'https://bros.bolehejas.com');
  assert.deepEqual([...url.searchParams.keys()],
    ['utm_source','utm_medium','utm_campaign','utm_content']);
  assert.equal(url.searchParams.get('utm_source'),'instagram');
  assert.equal(url.searchParams.get('utm_medium'),'organic_social');
  assert.equal(url.searchParams.get('utm_campaign'),'demand_sell_decision_state_v1');
  assert.equal(url.searchParams.get('utm_content'),'a');
});
test('A/B and channel identities do not collide',()=>{
  const a=proposeDemandPilotUtm(base);
  const b=proposeDemandPilotUtm({...base,variant:'b'});
  const other=proposeDemandPilotUtm({...base,channel:'facebook'});
  assert.notEqual(a.proposalId,b.proposalId);
  assert.notEqual(a.taggedUrl,b.taggedUrl);
  assert.notEqual(a.proposalId,other.proposalId);
});
test('proposal never represents publication, measured leads or sales',()=>{
  const x=proposeDemandPilotUtm(base);
  assert.equal(x.status,'PROPOSED');
  assert.equal(x.utmCaptureVerified,false);
  assert.equal(x.checkoutAttributionVerified,false);
  assert.equal(x.providerOutcomeVerified,false);
  assert.equal(x.qualifiedLeads,null);
  assert.equal(x.settledOrders,null);
  assert.equal(x.verifiedCacMinor,null);
  assert.equal(x.causalLift,null);
  assert.equal(Object.isFrozen(x),true);
});
test('rejects unsafe destinations, trackers, userinfo, hash and alternate paths',()=>{
  for(const landingUrl of [
    'http://bros.bolehejas.com/','https://evil.example/',
    'https://bros.bolehejas.com.evil.example/',
    'https://user:pass@bros.bolehejas.com/',
    'https://bros.bolehejas.com/?utm_source=untrusted',
    'https://bros.bolehejas.com/?next=https://evil.example',
    'https://bros.bolehejas.com/#secret',
    'https://bros.bolehejas.com/checkout','javascript:alert(1)','not a url'
  ]) assert.throws(()=>proposeDemandPilotUtm({...base,landingUrl}),invalid);
});
test('rejects invalid experiment, channel and variant tokens',()=>{
  for(const patch of [
    {experimentId:'UPPER'}, {experimentId:'ab'}, {experimentId:'x'.repeat(65)},
    {experimentId:'hello%20world'}, {experimentId:'a&email=secret'},
    {channel:'google'}, {channel:'instagram?utm_term=bad'},
    {variant:'c'}, {variant:'A'}
  ]) assert.throws(()=>proposeDemandPilotUtm({...base,...patch}),invalid);
});
test('does not require platform clickable-post support or assert checkout tracing',()=>{
  const x=proposeDemandPilotUtm({...base,channel:'tiktok'});
  assert.equal(x.channel,'tiktok');
  assert.equal(x.utmCaptureVerified,false);
  assert.equal(x.checkoutAttributionVerified,false);
});
