import test from "node:test";
import assert from "node:assert/strict";
import { assessDemandMetaPixelBinding } from "../lib/demand/meta-pixel-binding.ts";

const scope={tenantId:"11111111-1111-4111-8111-111111111111",product:"demand",
 accountId:"act_1997776120879476",campaignId:"120250864977630697",
 adId:"120250875287780697",expectedPixelId:"1636131111400103"};
const ad={id:scope.adId,campaign_id:scope.campaignId,status:"ACTIVE",
 effective_status:"CAMPAIGN_PAUSED",tracking_specs:[
 {"action.type":["offsite_conversion"],fb_pixel:["1636131111400103"]},
 {"action.type":["onsite_conversion"]},{"action.type":["link_click"]}]};
const coverage={missingScopes:null,droppedFields:null};
const inventory={rows:[{id:"1636131111400103",name:"BROS SELL Web Dataset",
 is_unavailable:false,last_fired_time:"2026-10-28T08:28:18+0800"}],
 nextPageToken:null,missingScopes:null,droppedFields:null};
const assess=(s=scope,a=ad,c=coverage,i=inventory)=>
 assessDemandMetaPixelBinding(s,a,c,i);

test("live-provider-shaped PREMIUM05 ad is configured to BROS SELL dataset, not a purchase",()=>{
 const x=assess();
 assert.equal(x.status,"PIXEL_CONFIG_MATCH_UNATTESTED");
 assert.equal(x.trackingPixelBindingObserved,true);
 assert.equal(x.effectiveStatus,"CAMPAIGN_PAUSED");
 assert.equal(x.pixelPurchaseVerified,false);
 assert.equal(x.eventTypeVerified,false);
 assert.equal(x.clickToOrderAttributionVerified,false);
 assert.equal(x.verifiedOrders,null);
 assert.equal(x.executionAllowed,false);
});
test("foreign pixel, multiple pixel IDs or unavailable inventory never pass binding",()=>{
 for(const a of [
 {...ad,tracking_specs:[{"action.type":["offsite_conversion"],fb_pixel:["999"]}]},
 {...ad,tracking_specs:[{"action.type":["offsite_conversion"],fb_pixel:["1636131111400103","999"]}]}
 ])assert.equal(assess(scope,a).trackingPixelBindingObserved,false);
 assert.equal(assess(scope,ad,coverage,{...inventory,rows:[{...inventory.rows[0],is_unavailable:true}]}).trackingPixelBindingObserved,false);
});
test("unread tracking_specs or inventory availability is unknown, never a confirmed negative",()=>{
 const {tracking_specs,...unread}=ad;
 assert.equal(assess(scope,unread).status,"PIXEL_CONFIG_UNREAD");
 assert.equal(assess(scope,ad,{...coverage,droppedFields:["tracking_specs"]}).status,"PIXEL_CONFIG_UNREAD");
 const {is_unavailable,...unreadPixel}=inventory.rows[0];
 assert.equal(assess(scope,ad,coverage,{...inventory,rows:[unreadPixel]}).status,"PIXEL_CONFIG_UNREAD");
});
test("stable replay and irrelevant activity timestamp do not create new evidence; policy and binding do",()=>{
 const baseline=assess();
 const replay=assess(scope,ad,coverage,{...inventory,rows:[{...inventory.rows[0],last_fired_time:"2026-10-29T00:00:00+0800"}]});
 assert.equal(baseline.snapshotId,replay.snapshotId);
 assert.notEqual(baseline.snapshotId,assess({...scope,expectedPixelId:"999"}).snapshotId);
 assert.notEqual(baseline.snapshotId,assess(scope,{...ad,tracking_specs:[{"action.type":["offsite_conversion"],fb_pixel:["999"]}]}).snapshotId);
});
test("incomplete pagination, missing scopes, duplicate inventory, forged identity fail closed",()=>{
 for(const i of [{...inventory,nextPageToken:"next"},
 {...inventory,missingScopes:["ads_read"]},
 {...inventory,rows:[inventory.rows[0],inventory.rows[0]]}])
 assert.throws(()=>assess(scope,ad,coverage,i),/Invalid BROS DEMAND/);
 assert.throws(()=>assess(scope,{...ad,campaign_id:"999"}),/Invalid BROS DEMAND/);
 assert.throws(()=>assess(scope,ad,{missingScopes:["ads_read"],droppedFields:null}),/Invalid BROS DEMAND/);
});
