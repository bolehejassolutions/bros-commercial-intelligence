import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDemandCampaignExecutionEvidence as assess } from '../lib/demand/meta-campaign-execution-evidence.ts';

const account='act_1997776120879476';
const target='120251158023300697';
// Privacy-minimized campaign status shape read from HYPD on 28 Oct 2026.
const response={
  rows:[
    {id:target,status:'PAUSED',effective_status:'PAUSED'},
    {id:'120250864977630697',status:'PAUSED',effective_status:'PAUSED'},
    {id:'120250828102660697',status:'PAUSED',effective_status:'PAUSED'},
  ],nextPageToken:null,missingScopes:null,
};

test('provider-observed 28 Oct paused acquisition campaign is not a verified experiment',()=>{
  const result=assess(account,target,response);
  assert.equal(result.state,'PAUSED_AT_READBACK');
  assert.equal(result.experimentActionVerified,false);
  assert.equal(result.statusProviderAuthenticationVerified,false);
  assert.equal(result.verifiedProviderOutcome,null);
  assert.equal(result.verifiedSettledOrders,null);
  assert.equal(result.verifiedCpaMinor,null);
  assert.equal(result.causalLift,null);
  assert.equal(result.durableBciLearningVerified,false);
  assert.equal(assess(account,target,structuredClone(response)).snapshotKey,result.snapshotKey);
});

test('active configuration is never promoted to confirmed delivery or sales',()=>{
  const changed=structuredClone(response);
  changed.rows[0].status='ACTIVE';
  changed.rows[0].effective_status='ACTIVE';
  const result=assess(account,target,changed);
  assert.equal(result.state,'ACTIVE_CONFIGURATION_UNVERIFIED_DELIVERY');
  assert.equal(result.experimentActionVerified,false);
  assert.equal(result.verifiedProviderOutcome,null);
  assert.notEqual(result.snapshotKey,assess(account,target,response).snapshotKey);
  changed.rows[0].effective_status='PAUSED';
  assert.equal(assess(account,target,changed).state,'STATUS_REQUIRES_REVIEW');
});

test('target missing is not zero delivery and campaign identity changes fingerprint',()=>{
  const result=assess(account,'120250000000000000',response);
  assert.equal(result.state,'TARGET_NOT_IN_INVENTORY');
  assert.equal(result.verifiedProviderOutcome,null);
  assert.notEqual(result.snapshotKey,assess(account,target,response).snapshotKey);
});

test('reject incomplete, conflicting or malformed provider envelopes',()=>{
  for(const patch of [
    {nextPageToken:'next'},
    {missingScopes:['ads_read']},
    {droppedFields:['effective_status']},
    {rows:[...response.rows,response.rows[0]]},
    {rows:[{id:target,status:'PAUSED',effective_status:null}]},
    {rows:[{id:target,status:'PAUSED',effective_status:'PAUSED',extra:true},null]},
  ]) assert.throws(()=>assess(account,target,{...response,...patch}));
  assert.throws(()=>assess('1997776120879476',target,response));
  assert.throws(()=>assess(account,[target],response));
});
