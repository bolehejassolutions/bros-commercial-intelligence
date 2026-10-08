import test from "node:test";
import assert from "node:assert/strict";
import {BROS_SELL_PRODUCT,safeDefaultDraft,validateCreative,generateOptionalGeminiDraft} from "../lib/marketing-operator/campaign-plan.ts";
import {FIXED_META_ACCOUNT,FIXED_DESTINATION,readWriteGate,validateApprovedPlan,makePausedObjects,metaCreatePaused,metaSetStatus} from "../lib/marketing-operator/meta-write.ts";

const now=Date.parse("2026-10-09T00:00:00Z");
const plan={
 id:"f9b5b329-021a-4409-bae3-f373317c9428",account_id:FIXED_META_ACCOUNT,
 name:"BROSSELL | MY | creative test",objective:"TRAFFIC",
 primary_text:safeDefaultDraft().primaryText,headline:safeDefaultDraft().headline,
 description:safeDefaultDraft().description,page_id:"123456789012345",
 image_hash:"a".repeat(32),pixel_id:null,duration_days:7,
 budget_cap_myr:100,authorization_expires_at:"2026-10-10T00:00:00Z",
 meta_campaign_id:null,meta_adset_id:null,meta_creative_id:null,meta_ad_id:null
};
test("Meta write gateway stays locked without deployment authorization",()=>{
 assert.throws(()=>readWriteGate({}),/locked/);
 assert.throws(()=>readWriteGate({META_OPERATOR_WRITE_ENABLED:"approved-v1"}),/credential/);
 assert.throws(()=>readWriteGate({META_OPERATOR_WRITE_ENABLED:"approved-v1",META_ADS_MANAGEMENT_TOKEN:"token".repeat(7)}),/portfolio/);
});
test("write gateway refuses missing, negative or invalid portfolio caps",()=>{
 for(const cap of ["","-1","Infinity","10001"]){
  assert.throws(()=>readWriteGate({META_OPERATOR_WRITE_ENABLED:"approved-v1",
   META_ADS_MANAGEMENT_TOKEN:"token".repeat(7),META_OPERATOR_PORTFOLIO_CAP_MYR:cap}));
 }
 const gate=readWriteGate({META_OPERATOR_WRITE_ENABLED:"approved-v1",
   META_ADS_MANAGEMENT_TOKEN:"token".repeat(7),META_OPERATOR_PORTFOLIO_CAP_MYR:"100"});
 assert.equal(gate.portfolioCapMYR,100);
});
test("canonical offer and copy avoid performance claims",()=>{
 assert.equal(BROS_SELL_PRODUCT.offerMYR,100);
 assert.match(safeDefaultDraft().primaryText,/36 bab/);
 assert.throws(()=>validateCreative({headline:"Guaranteed sale",primaryText:"Guaranteed 100% closing! ".repeat(4)}),/Prohibited/);
});
test("optional draft engine uses truthful deterministic fallback without API key",async()=>{
 const prev=process.env.GEMINI_API_KEY;delete process.env.GEMINI_API_KEY;
 try{const r=await generateOptionalGeminiDraft("New seller");
 assert.equal(r.source,"verified-template");}
 finally{if(prev!==undefined)process.env.GEMINI_API_KEY=prev;}
});
test("provider budget guard blocks overspending and wrong accounts",()=>{
 assert.throws(()=>validateApprovedPlan({...plan,account_id:"act_99999999"},100,now),/Unapproved/);
 assert.throws(()=>validateApprovedPlan({...plan,budget_cap_myr:101},100,now),/exceeds/);
 assert.throws(()=>validateApprovedPlan({...plan,authorization_expires_at:"2026-10-08T23:00:00Z"},100,now),/expired/);
 assert.throws(()=>validateApprovedPlan({...plan,image_hash:"not-verified"},100,now),/image hash/);
 assert.throws(()=>validateApprovedPlan({...plan,objective:"SALES"},100,now),/pixel/);
 assert.equal(validateApprovedPlan(plan,100,now).budgetMinorUnits,10000);
});
test("staged Meta objects are all PAUSED with exact capped lifetime budget",()=>{
 const obj=makePausedObjects(plan,now);
 assert.equal(obj.campaign.status,"PAUSED");
 assert.equal(obj.campaign.objective,"OUTCOME_TRAFFIC");
 const adset=obj.adset("1234567890");
 assert.equal(adset.status,"PAUSED");
 assert.equal(adset.lifetime_budget,10000);
 assert.deepEqual(adset.targeting.geo_locations.countries,["MY"]);
 assert.equal(adset.targeting.age_min,18);
 const creative=obj.creative.object_story_spec.link_data;
 assert.equal(creative.link,FIXED_DESTINATION);
 assert.equal(creative.image_hash,plan.image_hash);
 assert.equal(obj.ad("1234567890","1234567891").status,"PAUSED");
});
test("only fixed Graph endpoints are writable; no token in URL",async()=>{
 const calls=[];
 const fake=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({id:"1234567890"}),{status:200});};
 assert.equal(await metaCreatePaused(FIXED_META_ACCOUNT,"campaigns",{status:"PAUSED"},"valid-token",fake),"1234567890");
 assert.equal(calls.length,1);
 assert.ok(calls[0].url.includes("/act_1997776120879476/campaigns"));
 assert.equal(calls[0].init.method,"POST");
 assert.equal(calls[0].init.headers.Authorization,"Bearer valid-token");
 assert.ok(!calls[0].url.includes("valid-token"));
 await assert.rejects(()=>metaCreatePaused("act_123456789","campaigns",{},"valid-token",fake),/Unapproved/);
 assert.equal(calls.length,1);
});
test("live status actions only accept ACTIVE or PAUSED and reject missing provider IDs",async()=>{
 const calls=[];
 const fake=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({success:true}),{status:200});};
 await metaSetStatus("1234567890","PAUSED","valid-token",fake);
 assert.equal(calls[0].url,"https://graph.facebook.com/v24.0/1234567890");
 assert.equal(JSON.parse(calls[0].init.body).status,"PAUSED");
 await assert.rejects(()=>metaSetStatus("evil","ACTIVE","valid-token",fake),/Invalid/);
});
test("provider failures are fail-closed and cannot be treated as created ads",async()=>{
 const bad=async()=>new Response(JSON.stringify({error:{code:10,message:"permission missing"}}),{status:403});
 await assert.rejects(()=>metaCreatePaused(FIXED_META_ACCOUNT,"ads",{},"token",bad),/failed/);
 const ambiguous=async()=>new Response(JSON.stringify({}),{status:200});
 await assert.rejects(()=>metaCreatePaused(FIXED_META_ACCOUNT,"ads",{},"token",ambiguous),/do not retry/);
});
