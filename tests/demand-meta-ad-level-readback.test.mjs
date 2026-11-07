import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDemandMetaAdReadback } from "../lib/demand/meta-ad-level-readback.ts";
const scope = {tenantId:"11111111-1111-4111-8111-111111111111",product:"demand",accountId:"act_1997776120879476",campaignId:"120250864977630697",since:"2026-10-09",until:"2026-10-09",currency:"MYR"};
const query = {accountId:scope.accountId,objectId:scope.campaignId,level:"ad",since:scope.since,until:scope.until};
const row = (ad_id,spend,impressions,inline_link_clicks,actions) => ({ad_id,account_id:scope.accountId.slice(4),account_currency:scope.currency,adset_id:"120250864977650697",campaign_id:scope.campaignId,date_start:scope.since,date_stop:scope.until,spend,impressions,inline_link_clicks,attribution_setting:"1d_view_7d_click_1d_ev",...(actions===undefined?{}:{actions})});
const purchase = [{action_type:"purchase",value:1},{action_type:"omni_purchase",value:1},{action_type:"offsite_conversion.fb_pixel_purchase",value:1}];
const response = {rows:[row("100",4.32,"117","1",purchase),row("200",120.61,"3077","62")],nextPageToken:null,missingScopes:null,droppedFields:null};
const campaign = {spendMinor:12493,impressions:3194,inlineLinkClicks:63,metaAttributedPurchases:1};
const project=(s=scope,q=query,r=response,c=campaign)=>reconcileDemandMetaAdReadback(s,q,r,c);
test("provider-shaped ad totals reconcile while purchase is an unverified ad-level signal",()=>{
 const x=project();assert.equal(x.adCount,2);assert.equal(x.adTotalsMatchCampaign,true);
 assert.equal(x.adSpendMinor,12493);assert.equal(x.adImpressions,3194);assert.equal(x.adInlineLinkClicks,63);
 assert.deepEqual(x.positiveSignalAds,[{adId:"100",reportedPurchaseAliases:1,attributionSetting:"1d_view_7d_click_1d_ev"}]);
 assert.equal(x.incompletePurchaseActionCoverage,true);assert.equal(x.verifiedCpaMinor,null);
 assert.equal(x.providerAuthenticationVerified,false);assert.equal(x.executionAllowed,false);
 assert.equal(x.attributionWindowIsNotClickPath,true);
});
test("stable candidate ID across row order; changes when provider revisions occur",()=>{
 assert.equal(project().candidateId,project(scope,query,{...response,rows:[...response.rows].reverse()}).candidateId);
 assert.notEqual(project().candidateId,project(scope,query,{...response,rows:[{...response.rows[0],spend:4.33},response.rows[1]]}).candidateId);
});
test("incomplete pages, dropped fields, foreign parent, duplicate ad and missing identity fail closed",()=>{
 for(const patch of [{nextPageToken:"next"},{droppedFields:["spend"]},{missingScopes:["ads_read"]},{rows:[response.rows[0],response.rows[0]]},{rows:[{...response.rows[0],campaign_id:"999"}]},{rows:[{...response.rows[0],adset_id:null}]},{rows:[]}])
  assert.throws(()=>project(scope,query,{...response,...patch}),/Invalid BROS DEMAND/);
});
test("invalid numbers and conflicting aliases fail closed or remain unverified",()=>{
 for(const bad of [-1,"1.001","Infinity",null]) assert.throws(()=>project(scope,query,{...response,rows:[{...response.rows[0],spend:bad},response.rows[1]]}),/Invalid BROS DEMAND/);
 const mismatch=project(scope,query,{...response,rows:[{...response.rows[0],actions:[{action_type:"purchase",value:1},{action_type:"omni_purchase",value:2}]},response.rows[1]]});
 assert.equal(mismatch.positiveSignalAds.length,0);assert.equal(mismatch.incompletePurchaseActionCoverage,true);
});
test("mismatched campaign totals cannot be declared reconciled or converted into CPA",()=>{
 const x=project(scope,query,response,{...campaign,spendMinor:12494});assert.equal(x.adTotalsMatchCampaign,false);
 assert.equal(x.verifiedOrders,null);assert.equal(x.verifiedCacMinor,null);assert.equal(x.causalLift,null);
});
test("14 actual provider-shaped 9 Oct ad rows reconcile 124.93/3194/63 with only one positive attributed ad",()=>{
 const observed=[
 ["120250864977640697",15.95,446,22],
 ["120250875287780697",4.32,117,1],
 ["120250875287790697",26.23,470,8],
 ["120250875287800697",3.62,163,0],
 ["120250875287820697",0.84,79,0],
 ["120250875287830697",1.84,94,1],
 ["120250875287840697",6.82,408,9],
 ["120250875287850697",12.99,268,5],
 ["120250875287860697",4.38,83,3],
 ["120250875287870697",25.44,532,9],
 ["120250875287880697",2.95,41,0],
 ["120250875287890697",13.65,257,2],
 ["120250875287900697",3.45,119,1],
 ["120250875287910697",2.45,117,2],
 ];
 const rows=observed.map(([id,spend,impressions,clicks])=>row(id,spend,String(impressions),String(clicks),id==="120250875287780697"?purchase:undefined));
 const result=project(scope,query,{...response,rows});
 assert.equal(result.adCount,14);assert.equal(result.adTotalsMatchCampaign,true);
 assert.equal(result.adSpendMinor,12493);assert.equal(result.adImpressions,3194);assert.equal(result.adInlineLinkClicks,63);
 assert.equal(result.positiveSignalAds.length,1);
 assert.equal(result.positiveSignalAds[0].adId,"120250875287780697");
 assert.equal(result.positiveSignalAds[0].reportedPurchaseAliases,1);
 assert.equal(result.verifiedOrders,null);
});

test("Meta action/value revisions change candidate identity without claiming revenue",()=>{
 const base=project();
 const enriched=[{...response.rows[0],actions:[...purchase,{action_type:"landing_page_view",value:33}],
   action_values:[{action_type:"purchase",value:"50.00"},
     {action_type:"web_app_in_store_purchase",value:"0.01"}]},response.rows[1]];
 const r={...response,rows:enriched};
 const x=project(scope,query,r);
 const shuffled=project(scope,query,{...r,rows:[enriched[1],{...enriched[0],
   actions:[...enriched[0].actions].reverse(),
   action_values:[...enriched[0].action_values].reverse()}]});
 assert.equal(x.candidateId,shuffled.candidateId);
 assert.notEqual(x.candidateId,base.candidateId);
 const revised=project(scope,query,{...r,rows:[{...enriched[0],
   action_values:[{action_type:"purchase",value:"100.00"},
     {action_type:"web_app_in_store_purchase",value:"0.01"}]},enriched[1]]});
 assert.notEqual(x.candidateId,revised.candidateId);
 const revisedCount=project(scope,query,{...r,rows:[{...enriched[0],
   actions:[...purchase,{action_type:"landing_page_view",value:32}]},enriched[1]]});
 assert.notEqual(x.candidateId,revisedCount.candidateId);
 for(const item of [x,revised,revisedCount]){
   assert.equal(item.adTotalsMatchCampaign,true);
   assert.equal(item.verifiedOrders,null);
   assert.equal(item.verifiedCpaMinor,null);
   assert.equal(item.causalLift,null);
 }
});
test("conflicting duplicate action values and invalid attributed values fail closed",()=>{
 const invalid=/Invalid BROS DEMAND ad-level readback/;
 for(const action_values of [
   [{action_type:"purchase",value:"50"},{action_type:"purchase",value:"100"}],
   [{action_type:"purchase",value:-1}],
   [{action_type:"purchase",value:"Infinity"}],
   [{action_type:"purchase",value:"50.123456789"}],
 ]){
   assert.throws(()=>project(scope,query,{...response,rows:[
     {...response.rows[0],action_values},response.rows[1]]}),invalid);
 }
 assert.throws(()=>project(scope,query,{...response,rows:[
   {...response.rows[0],actions:[...purchase,{action_type:"landing_page_view",value:33},
     {action_type:"landing_page_view",value:32}]},response.rows[1]]}),invalid);
});

test("ad action-value fingerprint preserves eight-decimal revisions without float rounding",()=>{
 const actionValues = value => ({...response,rows:[
   {...response.rows[0],action_values:[{action_type:"purchase",value}]},
   response.rows[1]]});
 const first=project(scope,query,actionValues("999999999999.00000001"));
 const second=project(scope,query,actionValues("999999999999.00000002"));
 assert.notEqual(first.candidateId,second.candidateId);
 assert.equal(first.verifiedOrders,null);
 assert.equal(first.verifiedCpaMinor,null);
 assert.equal(first.providerAuthenticationVerified,false);
 assert.equal(project(scope,query,actionValues("50.00")).candidateId,
   project(scope,query,actionValues("50")).candidateId);
 for(const value of ["1000000000000.00000001","9007199254740993","0.000000001"])
   assert.throws(()=>project(scope,query,actionValues(value)),/Invalid BROS DEMAND/);
});
test("ad readback rejects coercible tenant IDs and impossible calendar dates",()=>{
 const invalid=/Invalid BROS DEMAND ad-level readback/;
 for(const patch of [
   {tenantId:[scope.tenantId]}, {accountId:[scope.accountId]},
   {campaignId:[scope.campaignId]},
   {tenantId:{toString:()=>scope.tenantId}},
 ]) assert.throws(()=>project({...scope,...patch}),invalid);
 const impossible="2026-02-30";
 const s={...scope,since:impossible,until:impossible};
 const q={...query,since:impossible,until:impossible};
 const r={...response,rows:response.rows.map(x=>({...x,date_start:impossible,date_stop:impossible}))};
 assert.throws(()=>project(s,q,r),invalid);
});

// Live HYPD ad Insights returns account_id and account_currency when explicitly
// requested. Do not accept default-field responses or cross-account/currency rows.
test("ad evidence requires provider account and MYR currency binding",()=>{
 const invalid=/Invalid BROS DEMAND ad-level readback/;
 const valid=project();
 assert.equal(valid.adTotalsMatchCampaign,true);
 for(const bad of [
   {account_id:"1997776120879477"},
   {account_id:"act_1997776120879476"},
   {account_id:null},
   {account_currency:"USD"},
   {account_currency:null},
 ]) assert.throws(()=>project(scope,query,{...response,rows:[{...response.rows[0],...bad},response.rows[1]]}),invalid);
 for(const key of ["account_id","account_currency"]){
   const copy={...response.rows[0]};delete copy[key];
   assert.throws(()=>project(scope,query,{...response,rows:[copy,response.rows[1]]}),invalid);
 }
 assert.equal(valid.verifiedOrders,null);
 assert.equal(valid.verifiedCpaMinor,null);
});
