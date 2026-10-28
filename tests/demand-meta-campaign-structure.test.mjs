import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDemandMetaCampaignStructure as assess } from '../lib/demand/meta-campaign-structure.ts';

const account='act_1997776120879476';
const target='120251158023300697';
const old='120250864977630697';
const deprecated='120250828102660697';
const oldSet='120250864977650697';
const deprecatedSet='120250828102670697';
const envelope=rows=>({rows,nextPageToken:null,missingScopes:null,droppedFields:null});
const campaigns=envelope([
  {id:target,status:'PAUSED',effective_status:'PAUSED'},
  {id:old,status:'PAUSED',effective_status:'PAUSED'},
  {id:deprecated,status:'PAUSED',effective_status:'PAUSED'},
]);
const adsets=envelope([
  {id:oldSet,campaign_id:old,status:'ACTIVE',effective_status:'CAMPAIGN_PAUSED'},
  {id:deprecatedSet,campaign_id:deprecated,status:'ACTIVE',effective_status:'CAMPAIGN_PAUSED'},
]);
// Actual 29 Oct provider account inventory: 14 historical ads, 3 deprecated ads,
// zero adsets/ads for the RM140 ACQ-V2 target. No customer data.
const oldIds=[
  '120250875287800697','120250875287790697','120250875287860697',
  '120250875287870697','120250875287890697','120250875287830697',
  '120250875287850697','120250875287880697','120250875287840697',
  '120250864977640697','120250875287910697','120250875287820697',
  '120250875287900697','120250875287780697',
];
const otherIds=['120250828303850697','120250828102650697','120250828353840697'];
const ads=envelope([
  ...oldIds.map((id,i)=>({id,campaign_id:old,adset_id:oldSet,
    status:'ACTIVE',effective_status:'CAMPAIGN_PAUSED',creative:{id:String(900000000+i)}})),
  ...otherIds.map((id,i)=>({id,campaign_id:deprecated,adset_id:deprecatedSet,
    status:i<2?'PAUSED':'ACTIVE',effective_status:i<2?'PAUSED':'CAMPAIGN_PAUSED',
    creative:{id:String(800000000+i)}})),
]);
const run=(c=campaigns,s=adsets,a=ads,id=target)=>assess(account,id,c,s,a);

test('29 Oct complete Meta inventories: ACQ-V2 has no adsets or ads, not an executed experiment',()=>{
  const result=run();
  assert.equal(campaigns.rows.length,3);
  assert.equal(adsets.rows.length,2);
  assert.equal(ads.rows.length,17);
  assert.equal(result.state,'NO_ADSETS_OR_ADS_AT_READBACK');
  assert.equal(result.campaignStatus,'PAUSED');
  assert.equal(result.adsetCount,0);
  assert.equal(result.adCount,0);
  assert.equal(result.creativeReferenceCount,0);
  assert.equal(result.completeAccountInventoriesObserved,true);
  assert.equal(result.structuralAssetsObserved,false);
  assert.equal(result.experimentActionVerified,false);
  assert.equal(result.verifiedPaidOrders,null);
  assert.equal(result.verifiedCpaMinor,null);
  assert.equal(result.causalLift,null);
  assert.equal(result.durableBciLearningVerified,false);
  assert.equal(run(envelope([...campaigns.rows].reverse()),
    envelope([...adsets.rows].reverse()),envelope([...ads.rows].reverse())).snapshotKey,
    result.snapshotKey);
});

test('other campaigns assets cannot be counted toward ACQ-V2 and active status is not delivery',()=>{
  const oldResult=run(campaigns,adsets,ads,old);
  assert.equal(oldResult.adsetCount,1);
  assert.equal(oldResult.adCount,14);
  assert.equal(oldResult.state,'ASSETS_PRESENT_DELIVERY_UNVERIFIED');
  assert.equal(oldResult.deliveryVerified,false);
  assert.equal(oldResult.verifiedProviderOutcome,null);
  const active=envelope(campaigns.rows.map(row=>row.id===target?
    {...row,status:'ACTIVE',effective_status:'ACTIVE'}:row));
  assert.equal(run(active).state,'NO_ADSETS_OR_ADS_AT_READBACK');
  assert.equal(run(active).deliveryVerified,false);
  assert.notEqual(run(active).snapshotKey,run().snapshotKey);
});

test('structural gaps and missing creative are explicit, never converted to verified action',()=>{
  const set={id:'120251158023300698',campaign_id:target,status:'PAUSED',effective_status:'PAUSED'};
  const s=envelope([...adsets.rows,set]);
  assert.equal(run(campaigns,s).state,'ADSETS_PRESENT_NO_ADS_AT_READBACK');
  const ad={id:'120251158023300699',campaign_id:target,adset_id:set.id,
    status:'PAUSED',effective_status:'PAUSED'};
  assert.equal(run(campaigns,s,envelope([...ads.rows,ad])).state,
    'ADS_MISSING_CREATIVE_REFERENCES');
  const withCreative=envelope([...ads.rows,{...ad,creative:{id:'999999999'}}]);
  const observed=run(campaigns,s,withCreative);
  assert.equal(observed.state,'ASSETS_PRESENT_DELIVERY_UNVERIFIED');
  assert.equal(observed.deliveryVerified,false);
  const orphan=envelope([...ads.rows,{...ad,adset_id:'999999998',creative:{id:'999999999'}}]);
  assert.equal(run(campaigns,s,orphan).state,'TARGET_ADS_WITHOUT_MATCHING_ADSET');
});

test('incomplete, duplicate, missing-scope and malformed inventories fail closed',()=>{
  for(const change of [
    {nextPageToken:'cursor'}, {missingScopes:['ads_read']},
    {droppedFields:['campaign_id']}, {rows:[...ads.rows,ads.rows[0]]},
    {rows:[...ads.rows,{id:'not-an-id',campaign_id:target,adset_id:'1',
      status:'ACTIVE',effective_status:'ACTIVE'}]},
  ]) assert.throws(()=>run(campaigns,adsets,{...ads,...change}));
  assert.throws(()=>run(campaigns,adsets,envelope([
    ...ads.rows,{id:'120251158023300699',campaign_id:target,
      adset_id:'1',status:'ACTIVE',effective_status:'ACTIVE',creative:{id:22}}
  ])));
  assert.throws(()=>assess('1997776120879476',target,campaigns,adsets,ads));
  assert.throws(()=>assess(account,[target],campaigns,adsets,ads));
  assert.equal(run(campaigns,adsets,ads,'120251158023300000').state,
    'TARGET_CAMPAIGN_NOT_IN_INVENTORY');
});
