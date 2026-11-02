import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {inspectMetaConnection,validateMetaTokenMetadata,FIXED_META_ACCOUNT,FIXED_META_BUSINESS,FIXED_META_APP} from "../lib/marketing-operator/meta-connection.ts";

const now=Date.parse("2026-10-09T00:00:00Z");
const appId=FIXED_META_APP;
const env={META_APP_ID:appId,META_APP_SECRET:"synthetic-app-secret-987654321",
 META_ADS_READ_TOKEN:"synthetic-read-token-987654321",META_ADS_MANAGEMENT_TOKEN:"synthetic-write-token-987654321",
 META_OPERATOR_WRITE_ENABLED:"approved-v1",META_OPERATOR_PORTFOLIO_CAP_MYR:"100"};
const debug=()=>({data:{app_id:appId,is_valid:true,expires_at:Math.floor(now/1000)+86400,
 data_access_expires_at:Math.floor(now/1000)+172800,scopes:["ads_read","ads_management"]}});
const app=()=>({id:appId,name:"BROS Commercial Intelligence",business:{id:FIXED_META_BUSINESS},owner_business:FIXED_META_BUSINESS});
const account=()=>({id:FIXED_META_ACCOUNT,account_id:FIXED_META_ACCOUNT.slice(4),account_status:1,
 currency:"MYR",timezone_name:"Asia/Kuala_Lumpur",business:{id:FIXED_META_BUSINESS},user_tasks:["MANAGE","ADVERTISE","ANALYZE"]});
function fakeProvider(overrides={}){
 const calls=[];
 const transport=async(url,init)=>{
  calls.push({url,init});const path=new URL(url).pathname;
  const body=path.endsWith("/debug_token")?(overrides.debug??debug()):
    path.endsWith("/"+appId)?(overrides.app??app()):
    path.endsWith("/owned_apps")?(overrides.ownedApps??{data:[{id:appId}]}):(overrides.account??account());
  return new Response(JSON.stringify(body),{status:200});
 };
 return {calls,transport};
}
test("missing or malformed private configuration never reaches Meta",async()=>{
 const {transport,calls}=fakeProvider();
 for(const key of ["META_APP_ID","META_APP_SECRET","META_ADS_READ_TOKEN"]){
  const input={...env};delete input[key];
  const result=await inspectMetaConnection("read",input,transport,now);
  assert.equal(result.status,"BLOCKED");assert.equal(result.reason,"MISSING_SERVER_CONFIGURATION");
 }
 const invalid=await inspectMetaConnection("read",{...env,META_APP_ID:"https://evil.invalid/token"},transport,now);
 assert.equal(invalid.reason,"INVALID_SERVER_CONFIGURATION");assert.equal(invalid.appId,null);
 const wrongApp=await inspectMetaConnection("read",{...env,META_APP_ID:"1804186003921534"},transport,now);
 assert.equal(wrongApp.reason,"APP_IDENTITY_MISMATCH");assert.equal(wrongApp.appId,null);
 assert.equal(calls.length,0);
});
test("preflight uses four bounded GETs with explicit fixed-business app ownership proof",async()=>{
 const {transport,calls}=fakeProvider();
 const result=await inspectMetaConnection("read",env,transport,now);
 assert.equal(result.status,"READY");assert.deepEqual(result.checks,{token:true,app:true,account:true});
 assert.equal(calls.length,4);
 for(const call of calls){
  const url=new URL(call.url);
  assert.equal(url.origin,"https://graph.facebook.com");assert.equal(call.init.method,"GET");
  assert.equal(call.init.redirect,"error");assert.equal(call.init.cache,"no-store");
  assert.ok(call.init.signal);assert.equal(call.init.body,undefined);
  assert.equal(url.searchParams.get("access_token"),null);
  assert.ok(!call.url.includes(env.META_APP_SECRET));
 }
 assert.equal(new URL(calls[0].url).pathname,"/v24.0/debug_token");
 assert.equal(new URL(calls[0].url).searchParams.get("input_token"),env.META_ADS_READ_TOKEN);
 assert.equal(calls[0].init.headers.Authorization,"Bearer "+appId+"|"+env.META_APP_SECRET);
 assert.equal(calls[1].init.headers.Authorization,"Bearer "+env.META_ADS_READ_TOKEN);
 assert.equal(new URL(calls[1].url).searchParams.get("appsecret_proof"),
  createHmac("sha256",env.META_APP_SECRET).update(env.META_ADS_READ_TOKEN).digest("hex"));
 assert.equal(new URL(calls[1].url).searchParams.get("fields"),"id,name");
 assert.equal(new URL(calls[2].url).pathname,"/v24.0/"+FIXED_META_BUSINESS+"/owned_apps");
 assert.equal(new URL(calls[2].url).searchParams.get("fields"),"id");
 assert.equal(calls[2].init.headers.Authorization,"Bearer "+env.META_ADS_READ_TOKEN);
 assert.equal(calls[3].init.headers.Authorization,"Bearer "+env.META_ADS_READ_TOKEN);
 assert.ok(!calls[1].url.includes(env.META_ADS_READ_TOKEN));assert.ok(!calls[2].url.includes(env.META_ADS_READ_TOKEN));
 const serialized=JSON.stringify(result);
 for(const secret of [env.META_APP_SECRET,env.META_ADS_READ_TOKEN,env.META_ADS_MANAGEMENT_TOKEN])assert.ok(!serialized.includes(secret));
 assert.ok(!serialized.includes("graph.facebook.com"));
});
test("token binding and matching app name cannot substitute for actual fixed-business ownership",async()=>{
 for(const [ownedApps,reason] of [
  [{data:[]},"APP_BUSINESS_MISMATCH"],
  [{data:[{id:"99999999999999"}]},"APP_BUSINESS_MISMATCH"],
  [{data:[],paging:{next:"https://untrusted.invalid/private-cursor"}},"APP_OWNERSHIP_READBACK_INCOMPLETE"],
  [{data:[{id:appId},{id:appId}]},"MALFORMED_PROVIDER_DATA"],
 ]){
  const f=fakeProvider({ownedApps});
  const r=await inspectMetaConnection("write",env,f.transport,now);
  assert.equal(r.status,"BLOCKED");assert.equal(r.reason,reason);
  assert.equal(r.checks.token,true);assert.equal(r.checks.app,false);assert.equal(r.checks.account,false);
  assert.equal(f.calls.length,3);assert.ok(f.calls.every(c=>c.init.method==="GET"));
  assert.ok(!JSON.stringify(r).includes("private-cursor"));
 }
 const positive=fakeProvider({app:{id:appId,name:"BROS Commercial Intelligence"}});
 assert.equal((await inspectMetaConnection("write",env,positive.transport,now)).status,"READY");
});
test("failed app lookup exposes only bounded numeric diagnostics and never retries or authorizes writes",async()=>{
 const f=fakeProvider();
 const result=await inspectMetaConnection("write",env,async(url,init)=>{
  if(new URL(url).pathname.endsWith("/"+appId)){
   assert.equal(init.headers.Authorization,"Bearer "+env.META_ADS_MANAGEMENT_TOKEN);
   return Response.json({error:{code:100,error_subcode:33,message:env.META_APP_SECRET,
    fbtrace_id:"private-provider-trace",error_data:{token:env.META_ADS_MANAGEMENT_TOKEN}}},{status:400});
  }
  return f.transport(url,init);
 },now);
 assert.equal(result.status,"BLOCKED");assert.equal(result.reason,"PROVIDER_REQUEST_FAILED");
 assert.deepEqual(result.checks,{token:true,app:false,account:false});
 assert.deepEqual(result.providerFailure,{phase:"app",status:400,code:100,subcode:33});
 const serialized=JSON.stringify(result);
 for(const secret of [env.META_APP_SECRET,env.META_ADS_MANAGEMENT_TOKEN,"private-provider-trace"])
  assert.ok(!serialized.includes(secret));
 assert.equal(f.calls.length,1,"only successful debug request is recorded; no account call or retry after failed app read");
});
test("invalid, wrong-app, expired, missing-scope and malformed token responses block before app/account",async()=>{
 const variants=[
  [{is_valid:false},"TOKEN_INVALID"], [{app_id:"99999999999"},"TOKEN_APP_MISMATCH"],
  [{expires_at:Math.floor(now/1000)},"TOKEN_EXPIRED"], [{expires_at:-1},"MALFORMED_PROVIDER_DATA"],
  [{expires_at:undefined},"MALFORMED_PROVIDER_DATA"],
  [{data_access_expires_at:Math.floor(now/1000)-1},"TOKEN_EXPIRED"],
  [{scopes:["public_profile"]},"TOKEN_SCOPE_MISSING"], [{scopes:[null]},"MALFORMED_PROVIDER_DATA"],
 ];
 for(const [change,reason]of variants){
  const payload=debug();Object.assign(payload.data,change);
  const {transport,calls}=fakeProvider({debug:payload});
  const result=await inspectMetaConnection("write",env,transport,now);
  assert.equal(result.reason,reason);assert.equal(result.status,"BLOCKED");assert.equal(calls.length,1);
 }
});
test("read accepts ads_read or ads_management but write requires ads_management",()=>{
 const payload=debug();payload.data.scopes=["ads_management"];
 assert.doesNotThrow(()=>validateMetaTokenMetadata(payload,appId,"read",now));
 payload.data.scopes=["ads_read"];
 assert.doesNotThrow(()=>validateMetaTokenMetadata(payload,appId,"read",now));
 assert.throws(()=>validateMetaTokenMetadata(payload,appId,"write",now),/TOKEN_SCOPE_MISSING/);
});
test("explicit non-expiring token and optional data-access expiry are interpreted safely",()=>{
 const payload=debug();payload.data.expires_at=0;delete payload.data.data_access_expires_at;
 assert.deepEqual(validateMetaTokenMetadata(payload,appId,"write",now),{expiresAt:0,dataAccessExpiresAt:null});
 payload.data.data_access_expires_at=Infinity;
 assert.throws(()=>validateMetaTokenMetadata(payload,appId,"write",now),/MALFORMED_PROVIDER_DATA/);
});
test("present granular grants must cover the fixed ad account",()=>{
 const payload=debug();payload.data.granular_scopes=[{scope:"ads_management",target_ids:["999999999999"]}];
 assert.throws(()=>validateMetaTokenMetadata(payload,appId,"write",now),/TOKEN_TARGET_MISMATCH/);
 payload.data.granular_scopes[0].target_ids=[FIXED_META_ACCOUNT.slice(4)];
 assert.doesNotThrow(()=>validateMetaTokenMetadata(payload,appId,"write",now));
});
test("wrong app identity or portfolio and wrong account settings fail closed",async()=>{
 const variants=[
  [{app:{...app(),id:"99999999999"}},"APP_IDENTITY_MISMATCH"],
  [{app:{...app(),name:"Unapproved App"}},"APP_IDENTITY_MISMATCH"],
  [{app:{...app(),business:null,owner_business:null}},"APP_BUSINESS_MISMATCH"],
  [{app:{...app(),owner_business:"99999999999"}},"APP_BUSINESS_MISMATCH"],
  [{account:{...account(),id:"act_99999999999"}},"ACCOUNT_IDENTITY_MISMATCH"],
  [{account:{...account(),business:{id:"99999999999"}}},"ACCOUNT_BUSINESS_MISMATCH"],
  [{account:{...account(),currency:"USD"}},"ACCOUNT_SETTINGS_MISMATCH"],
  [{account:{...account(),timezone_name:"UTC"}},"ACCOUNT_SETTINGS_MISMATCH"],
  [{account:{...account(),account_status:2}},"ACCOUNT_SETTINGS_MISMATCH"],
  [{account:{...account(),user_tasks:["ANALYZE"]}},"ACCOUNT_WRITE_TASK_MISSING"],
  [{account:{...account(),user_tasks:undefined}},"ACCOUNT_WRITE_TASK_MISSING"],
 ];
 for(const [override,reason]of variants){
  const {transport}=fakeProvider(override);const result=await inspectMetaConnection("write",env,transport,now);
  assert.equal(result.status,"BLOCKED");assert.equal(result.reason,reason);
 }
});
test("provider failure, malformed JSON and secret-bearing exceptions never leak",async()=>{
 for(const transport of [
  async()=>new Response(JSON.stringify({error:{message:env.META_APP_SECRET}}),{status:400}),
  async()=>new Response("invalid JSON "+env.META_ADS_READ_TOKEN,{status:200}),
  async(url)=>{throw Error(url+" "+env.META_APP_SECRET);},
  async()=>new Response(JSON.stringify({data:null}),{status:200}),
 ]){
  const result=await inspectMetaConnection("read",env,transport,now);
  assert.equal(result.status,"BLOCKED");
  const serialized=JSON.stringify(result);
  assert.ok(!serialized.includes(env.META_APP_SECRET));assert.ok(!serialized.includes(env.META_ADS_READ_TOKEN));
  assert.ok(!serialized.includes("input_token"));
 }
});
