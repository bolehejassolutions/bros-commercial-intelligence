import test from "node:test";
import assert from "node:assert/strict";
import {FIXED_META_ACCOUNT,metaCreatePaused,metaSetStatus,requireExclusiveCampaignDelivery} from "../lib/marketing-operator/meta-write.ts";
import {fetchMetaReadOnlyInsights} from "../lib/marketing-operator/meta-readonly.ts";
import {metaCampaignSpend} from "../lib/marketing-operator/monitor.ts";
import {safeMetaProviderCode} from "../lib/marketing-operator/meta-provider.ts";

const secret="synthetic-credential-that-must-never-leak";
const operations=[
 transport=>metaCreatePaused(FIXED_META_ACCOUNT,"campaigns",{status:"PAUSED"},secret,transport),
 transport=>metaSetStatus("123456789012345","PAUSED",secret,transport),
 transport=>requireExclusiveCampaignDelivery("123456789012345",secret,transport),
 transport=>fetchMetaReadOnlyInsights(FIXED_META_ACCOUNT,secret,"2026-10-08","2026-10-08",transport),
 transport=>metaCampaignSpend("123456789012345",secret,"2026-10-08","2026-10-09",transport),
];
test("all subsequent Meta operations redact transport and JSON errors before callers can store/return them",async()=>{
 for(const operation of operations){
  for(const failure of ["transport","json","provider"]){
   const transport=async(url,init)=>{
    assert.equal(init.redirect,"error");assert.equal(init.cache,"no-store");
    if(failure==="transport")throw Error("request "+url+" token="+secret);
    if(failure==="json")return new Response("not JSON, "+secret,{status:200});
    return new Response(JSON.stringify({error:{code:secret,message:secret}}),{status:403});
   };
   await assert.rejects(()=>operation(transport),error=>{
    // Routes persist/return Error.message; this is the value crossing that boundary.
    const storedReason=error.message;
    assert.ok(!storedReason.includes(secret));assert.ok(!storedReason.includes("graph.facebook.com"));
    assert.ok(!storedReason.includes("input_token"));return true;
   });
  }
 }
});
test("only bounded numeric provider codes may enter public error reasons",()=>{
 for(const value of [secret,{},null,Infinity,-1,1000001])assert.equal(safeMetaProviderCode(value,502),502);
 assert.equal(safeMetaProviderCode(613,502),613);
});
