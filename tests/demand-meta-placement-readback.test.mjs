import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDemandMetaPlacementReadback as reconcile } from "../lib/demand/meta-placement-readback.ts";
const scope = {tenantId:"11111111-1111-4111-8111-111111111111",product:"demand",accountId:"act_1997776120879476",campaignId:"120250864977630697",adId:"120250875287780697",since:"2026-10-09",until:"2026-10-09",currency:"MYR"};
const query = {accountId:scope.accountId,objectId:scope.adId,level:"ad",since:scope.since,until:scope.until,breakdowns:["publisher_platform"]};
const row=(publisher_platform,spend,impressions,inline_link_clicks,actions)=>({publisher_platform,spend,impressions,inline_link_clicks,account_currency:"MYR",ad_id:scope.adId,adset_id:"120250864977650697",campaign_id:scope.campaignId,date_start:scope.since,date_stop:scope.until,...(actions?{actions}:{})});
const purchase=[{action_type:"purchase",value:1},{action_type:"omni_purchase",value:1},{action_type:"offsite_conversion.fb_pixel_purchase",value:1}];
const response={rows:[row("audience_network",0.01,"4","0"),row("facebook",3.4,"81","1",purchase),row("instagram",0.84,"21","0"),row("threads",0.07,"10","0"),row("whatsapp",0,"1","0")],nextPageToken:null,missingScopes:null,droppedFields:null};
const totals={spendMinor:432,impressions:117,inlineLinkClicks:1};
const project=(s=scope,q=query,r=response,t=totals)=>reconcile(s,q,r,t);
test("real-provider-shaped five placements reconcile 4.32 MYR, 117 impressions and one inline click",()=>{
 const x=project();assert.equal(x.placementCount,5);assert.equal(x.adTotalsMatch,true);
 assert.equal(x.observedSpendMinor,432);assert.equal(x.observedImpressions,117);assert.equal(x.observedInlineLinkClicks,1);
 assert.deepEqual(x.positiveAttributedPurchasePlacements,[{platform:"facebook",reportedPurchaseAliases:1}]);
 assert.equal(x.purchaseActionCoverageIncomplete,true);assert.equal(x.clickToOrderVerified,false);
 assert.equal(x.verifiedOrders,null);assert.equal(x.verifiedCpaMinor,null);assert.equal(x.causalLift,null);
 assert.equal(x.executionAllowed,false);
});
test("stable content ID regardless of placement row order; material changes produce new ID",()=>{
 assert.equal(project().candidateId,project(scope,query,{...response,rows:[...response.rows].reverse()}).candidateId);
 assert.notEqual(project().candidateId,project(scope,query,{...response,rows:response.rows.map(r=>r.publisher_platform==="facebook"?{...r,spend:3.41}:r)}).candidateId);
 assert.notEqual(project().candidateId,project(scope,query,response,{...totals,spendMinor:433}).candidateId);
});
test("incomplete provider page, scopes, fields, duplicate placement, forged IDs or dates fail closed",()=>{
 for(const patch of [{nextPageToken:"next"},{missingScopes:["ads_read"]},{droppedFields:["actions"]},{rows:[response.rows[0],response.rows[0]]},{rows:[{...response.rows[0],ad_id:"999"}]},{rows:[{...response.rows[0],campaign_id:"999"}]},{rows:[{...response.rows[0],date_start:"2026-10-10"}]},{rows:[{...response.rows[0],publisher_platform:"unknown"}]},{rows:[]}])
  assert.throws(()=>project(scope,query,{...response,...patch}),/Invalid BROS DEMAND/);
 assert.throws(()=>project({...scope,tenantId:[scope.tenantId]}),/Invalid BROS DEMAND/);
 assert.throws(()=>project({...scope,since:"2026-02-30"}),/Invalid BROS DEMAND/);
 assert.throws(()=>project(scope,{...query,breakdowns:["publisher_platform","age"]}),/Invalid BROS DEMAND/);
});
test("missing action data is unknown, not zero; conflicting purchase aliases never count as sales",()=>{
 const x=project();assert.equal(x.placementObservations.find(o=>o.platform==="instagram").reportedPurchaseAliases,null);
 const conflict=project(scope,query,{...response,rows:response.rows.map(r=>r.publisher_platform==="facebook"?{...r,actions:[{action_type:"purchase",value:1},{action_type:"omni_purchase",value:2}]}:r)});
 assert.equal(conflict.positiveAttributedPurchasePlacements.length,0);
 assert.equal(conflict.purchaseActionCoverageIncomplete,true);
 assert.equal(conflict.placementObservations.find(o=>o.platform==="facebook").purchaseAliasConflict,true);
});
test("bad numbers, duplicate conflicting labels, unsupported currencies and mismatched totals cannot verify acquisition",()=>{
 for(const bad of [-1,"1.001","Infinity",null]) assert.throws(()=>project(scope,query,{...response,rows:[{...response.rows[0],spend:bad},...response.rows.slice(1)]}),/Invalid BROS DEMAND/);
 assert.throws(()=>project(scope,query,{...response,rows:response.rows.map(r=>r.publisher_platform==="facebook"?{...r,actions:[...purchase,{action_type:"purchase",value:2}]}:r)}),/Invalid BROS DEMAND/);
 assert.throws(()=>project(scope,query,{...response,rows:[{...response.rows[0],account_currency:"USD"},...response.rows.slice(1)]}),/Invalid BROS DEMAND/);
 const mismatch=project(scope,query,response,{...totals,impressions:118});
 assert.equal(mismatch.adTotalsMatch,false);assert.equal(mismatch.verifiedCacMinor,null);assert.equal(mismatch.outcomeVerified,false);
});
