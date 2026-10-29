import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDemandCampaignExecutionEvidence as assess, assessDemandCampaignActivityCandidates as assessActivity } from '../lib/demand/meta-campaign-execution-evidence.ts';

const account='act_1997776120879476';
const target='120251158023300697';
// Privacy-minimized campaign status shape read from HYPD on 28 Oct 2026.
const response={
  rows:[
    {id:target,status:'PAUSED',effective_status:'PAUSED',lifetime_budget:'14000'},
    {id:'120250864977630697',status:'PAUSED',effective_status:'PAUSED'},
    {id:'120250828102660697',status:'PAUSED',effective_status:'PAUSED'},
  ],nextPageToken:null,missingScopes:null,
};

test('provider-observed 28 Oct paused acquisition campaign is not a verified experiment',()=>{
  const result=assess(account,target,response);
  assert.equal(result.state,'PAUSED_AT_READBACK');
  assert.equal(result.configuredLifetimeBudgetMinorUnits,14000);
  assert.equal(result.configuredDailyBudgetMinorUnits,null);
  assert.equal(result.budgetConfigurationObserved,true);
  assert.equal(result.budgetConfigurationIsSpendEvidence,false);
  assert.equal(result.measuredSpendMinorUnits,null);
  assert.equal(result.experimentActionVerified,false);
  assert.equal(result.statusProviderAuthenticationVerified,false);
  assert.equal(result.verifiedProviderOutcome,null);
  assert.equal(result.verifiedSettledOrders,null);
  assert.equal(result.verifiedCpaMinor,null);
  assert.equal(result.causalLift,null);
  assert.equal(result.durableBciLearningVerified,false);
  assert.equal(assess(account,target,structuredClone(response)).snapshotKey,result.snapshotKey);
});

test('actual RM140 lifetime budget configuration is not spend; budget revisions change immutable evidence identity',()=>{
  const baseline=assess(account,target,response);
  const revised=structuredClone(response);
  revised.rows[0].lifetime_budget='15000';
  assert.equal(assess(account,target,revised).configuredLifetimeBudgetMinorUnits,15000);
  assert.notEqual(assess(account,target,revised).snapshotKey,baseline.snapshotKey);
  const missing=structuredClone(response);
  delete missing.rows[0].lifetime_budget;
  assert.equal(assess(account,target,missing).configuredLifetimeBudgetMinorUnits,null);
  assert.equal(assess(account,target,missing).budgetConfigurationObserved,false);
  assert.notEqual(assess(account,target,missing).snapshotKey,baseline.snapshotKey);
  const daily=structuredClone(response);
  daily.rows[0].daily_budget='3000';
  assert.equal(assess(account,target,daily).configuredDailyBudgetMinorUnits,3000);
  assert.notEqual(assess(account,target,daily).snapshotKey,baseline.snapshotKey);
  for(const invalid of ['-1','140.00','1e4','0900','9007199254740992',{},42]){
    const malformed=structuredClone(response);
    malformed.rows[0].lifetime_budget=invalid;
    assert.throws(()=>assess(account,target,malformed));
  }
  assert.equal(baseline.experimentActionVerified,false);
  assert.equal(baseline.verifiedProviderOutcome,null);
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


// DEMAND_META_ACTIVITY_CANDIDATE_GUARD_20261028_2304_V1: real HYPD 27 Oct 2026 account activity SHAPE,
// privacy-minimized: no actor IDs or names retained.
const activityName='BROSSELL | SALES | MY | RM100 | ACQ-V2 | 20261027 | TEST7D';
const activityFeed={
  rows:[
    {event_type:'update_campaign_run_status',event_time:'2026-10-27T10:55:00+0000',object_name:activityName},
    {event_type:'update_campaign_run_status',event_time:'2026-10-27T10:49:55+0000',object_name:activityName},
    {event_type:'create_campaign_group',event_time:'2026-10-27T05:06:35+0000',object_name:activityName},
    {event_type:'update_campaign_name',event_time:'2026-10-27T05:06:01+0000',object_name:'[DEPRECATED 2026-10-27] OTHER CAMPAIGN'},
  ],nextPageToken:null,missingScopes:null,
};
const activity=(r=activityFeed,name=activityName)=>assessActivity(
  account,target,name,'2026-10-25','2026-10-28',r);

test('actual HYPD activity shape is only a name-matched candidate, not campaign action proof',()=>{
  const a=activity();
  assert.equal(a.state,'NAME_MATCHED_STATUS_ACTIVITY_UNATTESTED');
  assert.equal(a.matchingNameActivityRows,3);
  assert.equal(a.statusChangeCandidates,2);
  assert.equal(a.identityBinding,'CAMPAIGN_NAME_ONLY_UNATTESTED');
  assert.equal(a.experimentActionVerified,false);
  assert.equal(a.ownerApprovalVerified,false);
  assert.equal(a.verifiedSpendMinor,null);
  assert.equal(a.verifiedPaidOrders,null);
  assert.equal(a.verifiedCpaMinor,null);
  assert.equal(a.causalLift,null);
  assert.equal(a.durableBciLearningVerified,false);
  assert.equal(activity({...activityFeed,rows:[...activityFeed.rows].reverse()}).snapshotKey,a.snapshotKey);
});

test('name mismatch is unknown, and activity revisions change stable candidate ID',()=>{
  assert.equal(activity(activityFeed,'BROSSELL | OTHER CAMPAIGN').state,
    'NO_MATCHING_ACTIVITY_ROWS_NOT_ZERO');
  const revision=structuredClone(activityFeed);
  revision.rows[0].event_time='2026-10-27T10:56:00+0000';
  assert.notEqual(activity(revision).snapshotKey,activity().snapshotKey);
  const createOnly={...activityFeed,rows:[activityFeed.rows[2]]};
  assert.equal(activity(createOnly).state,'NAME_MATCHED_OTHER_ACTIVITY_UNATTESTED');
  assert.equal(activity(createOnly).statusChangeCandidates,0);
});

test('activity readback rejects incomplete, paginated, or malformed provider envelopes',()=>{
  for(const patch of [
    {nextPageToken:'more'},
    {missingScopes:['ads_read']},
    {droppedFields:['event_time']},
    {rows:[...activityFeed.rows,{event_type:'update_campaign_run_status',event_time:'invalid',object_name:activityName}]},
    {rows:[...activityFeed.rows,{event_type:22,event_time:'2026-10-27T10:55:00+0000',object_name:activityName}]},
  ]) assert.throws(()=>activity({...activityFeed,...patch}));
  assert.throws(()=>assessActivity(account,[target],activityName,'2026-10-25','2026-10-28',activityFeed));
  assert.throws(()=>assessActivity(account,target,activityName,'2026-02-30','2026-10-28',activityFeed));
});
