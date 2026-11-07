import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDemandMetaUtmCohort } from '../lib/demand/meta-utm-cohort.ts';
const scope = {tenantId:'11111111-1111-4111-8111-111111111111',accountId:'act_1997776120879476',campaignId:'120250864977630697',expectedCampaignAds:3};
const row=(id,label,campaignId=scope.campaignId)=>({id,campaign_id:campaignId,creative:{id:String(Number(id)+1),url_tags:`utm_campaign=brossell_rm100_ugc_20261008&utm_content=${label}&ad_id={{ad.id}}`}});
const rows=[row('120250875287860697','ugc01'),row('120250864977640697','ugc01'),row('120250875287780697','premium05'),row('120250828303850697','c01_s45_v01','120250828102660697')];
const response={rows,nextPageToken:null,missingScopes:null,droppedFields:null};
const assess=(s=scope,r=response)=>assessDemandMetaUtmCohort(s,r);
test('live-provider-shaped PREMIUM02/UGC01 collision isolated to selected campaign',()=>{
 const x=assess();assert.equal(x.inspectedAds,3);assert.equal(x.distinctUtmContentLabels,2);
 assert.deepEqual(x.collisions,[{utmContent:'ugc01',adIds:['120250864977640697','120250875287860697']}]);
 assert.equal(x.status,'UTM_CONTENT_COLLISION_OBSERVED');assert.equal(x.allAdIdMacrosConfigured,true);
 assert.equal(x.dynamicMacroExpansionVerified,false);assert.equal(x.firstPartyUtmCaptureVerified,false);
 assert.equal(x.verifiedOrders,null);assert.equal(x.verifiedCpaMinor,null);assert.equal(x.causalLift,null);
 assert.equal(x.executionAllowed,false);
});
test('stable id ignores account-list ordering but changes with actual label and ad-id macro',()=>{
 assert.equal(assess().snapshotId,assess(scope,{...response,rows:[...rows].reverse()}).snapshotId);
 const changed=[{...rows[0],creative:{...rows[0].creative,url_tags:rows[0].creative.url_tags.replace('ugc01','premium02')}},...rows.slice(1)];
 assert.notEqual(assess().snapshotId,assess(scope,{...response,rows:changed}).snapshotId);
 assert.equal(assess(scope,{...response,rows:changed}).collisions.length,0);
 const missingMacro=[{...rows[0],creative:{...rows[0].creative,url_tags:rows[0].creative.url_tags.replace('ad_id={{ad.id}}','ad_id=static')}},...rows.slice(1)];
 assert.equal(assess(scope,{...response,rows:missingMacro}).allAdIdMacrosConfigured,false);
});
test('partial, duplicate, ambiguous and malformed provider evidence fails closed',()=>{
 for(const patch of [{nextPageToken:'next'},{missingScopes:['ads_read']},{droppedFields:['creative']},{rows:rows.slice(1)},{rows:[...rows,rows[0]]}])
  assert.throws(()=>assess(scope,{...response,...patch}),/Invalid BROS DEMAND/);
 const invalidTags=[{...rows[0],creative:{...rows[0].creative,url_tags:'utm_content=ugc01&utm_content=ugc01&utm_campaign=campaign'}},...rows.slice(1)];
 assert.throws(()=>assess(scope,{...response,rows:invalidTags}),/Invalid BROS DEMAND/);
 assert.throws(()=>assess({...scope,tenantId:'other'}),/Invalid BROS DEMAND/);
});
test('different campaign labels cannot be misclassified as a same-campaign collision',()=>{
 const r={...response,rows:[row('120250875287860697','premium02'),row('120250864977640697','ugc01'),row('120250875287780697','premium05'),row('120250828303850697','ugc01','120250828102660697')]};
 assert.equal(assess(scope,r).collisions.length,0);
});
