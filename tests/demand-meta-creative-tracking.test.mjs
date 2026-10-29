import test from "node:test";
import assert from "node:assert/strict";
import { assessDemandMetaCreativeTracking } from "../lib/demand/meta-creative-tracking.ts";
const scope={tenantId:"11111111-1111-4111-8111-111111111111",product:"demand",accountId:"act_1997776120879476",campaignId:"120250864977630697",adId:"120250875287780697",expectedLandingUrl:"https://bros.bolehejas.com/",expectedUtmCampaign:"brossell_rm100_ugc_20261008",expectedUtmContent:"premium05"};
const ad={id:scope.adId,campaign_id:scope.campaignId,adset_id:"120250864977650697",creative:{id:"975612278938974"},status:"ACTIVE",effective_status:"CAMPAIGN_PAUSED"};
const url_tags="utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign=brossell_rm100_ugc_20261008&utm_content=premium05&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}";
const creative={id:ad.creative.id,url_tags,object_story_spec:{link_data:{link:"https://bros.bolehejas.com/"}}};
const response={rows:[creative],nextPageToken:null,missingScopes:null,droppedFields:null};
const assess=(s=scope,a=ad,r=response)=>assessDemandMetaCreativeTracking(s,a,r);
test("provider-shaped PREMIUM05 ad→creative identity and UTM template are observations only",()=>{
 const x=assess();assert.equal(x.status,"TEMPLATE_READY_UNATTESTED");
 assert.equal(x.creativeId,"975612278938974");assert.equal(x.effectiveStatus,"CAMPAIGN_PAUSED");
 assert.equal(x.trackingTemplateReady,true);assert.equal(x.liveClickOrFbclidVerified,false);
 assert.equal(x.landingToCheckoutUtmPersistenceVerified,false);
 assert.equal(x.hitpayEventToOrderJoinVerified,false);assert.equal(x.verifiedOrders,null);
 assert.equal(x.executionAllowed,false);assert.equal(x.verifiedCpaMinor,null);
});
test("candidate identity stable under tag reordering; status and creative changes alter it",()=>{
 const reversed={...creative,url_tags:url_tags.split("&").reverse().join("&")};
 assert.equal(assess().snapshotId,assess(scope,ad,{...response,rows:[reversed]}).snapshotId);
 assert.notEqual(assess().snapshotId,assess(scope,{...ad,effective_status:"ACTIVE"}).snapshotId);
 assert.notEqual(assess().snapshotId,assess(scope,ad,{...response,rows:[{...creative,url_tags:url_tags.replace("premium05","premium06")}]}).snapshotId);
});
test("changing the expected tracking policy changes the evidence ID even when the Meta creative is unchanged",()=>{
 const baseline=assess();
 const changedCampaign=assess({...scope,expectedUtmCampaign:"brossell_rm100_ugc_20261009"});
 const changedContent=assess({...scope,expectedUtmContent:"premium06"});
 assert.equal(baseline.trackingTemplateReady,true);
 assert.equal(changedCampaign.trackingTemplateReady,false);
 assert.equal(changedContent.trackingTemplateReady,false);
 assert.notEqual(baseline.snapshotId,changedCampaign.snapshotId);
 assert.notEqual(baseline.snapshotId,changedContent.snapshotId);
 assert.notEqual(changedCampaign.snapshotId,changedContent.snapshotId);
});
test("missing or changed UTM and dynamic tokens are not verified",()=>{
 for(const changed of [url_tags.replace("premium05","premium06"),url_tags.replace("{{ad.id}}","120250875287780697"),url_tags.replace("&utm_medium=paid_social","")]){
  const x=assess(scope,ad,{...response,rows:[{...creative,url_tags:changed}]});
  assert.equal(x.status,"TEMPLATE_INCOMPLETE_UNATTESTED");
  assert.equal(x.hitpayEventToOrderJoinVerified,false);
 }
});
test("foreign ad/creative, unsafe landing, incomplete page and missing scope fail closed",()=>{
 for(const bad of [{...ad,id:"999"},{...ad,campaign_id:"999"},{...ad,creative:{id:"999"}}])
  assert.throws(()=>assess(scope,bad),/Invalid BROS DEMAND/);
 for(const link of ["http://bros.bolehejas.com/","https://evil.example/","https://bros.bolehejas.com/?redirect=evil"])
  assert.throws(()=>assess(scope,ad,{...response,rows:[{...creative,object_story_spec:{link_data:{link}}}]}),/Invalid BROS DEMAND/);
 for(const patch of [{nextPageToken:"next"},{missingScopes:["ads_read"]},{droppedFields:["url_tags"]},{rows:[]},{rows:[creative,creative]}])
  assert.throws(()=>assess(scope,ad,{...response,...patch}),/Invalid BROS DEMAND/);
});
test("duplicate and extra tags cannot be mistaken for complete template",()=>{
 assert.throws(()=>assess(scope,ad,{...response,rows:[{...creative,url_tags:url_tags+"&ad_id=other"}]}),/Invalid BROS DEMAND/);
 const x=assess(scope,ad,{...response,rows:[{...creative,url_tags:url_tags+"&click_id={{ad.id}}"}]});
 assert.equal(x.status,"TEMPLATE_INCOMPLETE_UNATTESTED");assert.deepEqual(x.extraTags,["click_id"]);
});
