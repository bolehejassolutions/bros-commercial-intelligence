import test from "node:test";
import assert from "node:assert/strict";
import {readVerifiedWriteGate} from "../lib/marketing-operator/meta-write.ts";
import {inspectMetaConnection,validateMetaTokenMetadata,FIXED_META_ACCOUNT,FIXED_META_BUSINESS,FIXED_META_APP} from "../lib/marketing-operator/meta-connection.ts";
import {pauseOnlyWhenAtCap} from "../lib/marketing-operator/monitor.ts";

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
    path.endsWith("/"+appId)?(overrides.app??app()):(overrides.account??account());
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
test("preflight uses three bounded GET requests and only sanitized identity/expiry output",async()=>{
 const {transport,calls}=fakeProvider();
 const result=await inspectMetaConnection("read",env,transport,now);
 assert.equal(result.status,"READY");assert.deepEqual(result.checks,{token:true,app:true,account:true});
 assert.equal(calls.length,3);
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
 assert.equal(calls[2].init.headers.Authorization,"Bearer "+env.META_ADS_READ_TOKEN);
 assert.ok(!calls[1].url.includes(env.META_ADS_READ_TOKEN));assert.ok(!calls[2].url.includes(env.META_ADS_READ_TOKEN));
 const serialized=JSON.stringify(result);
 for(const secret of [env.META_APP_SECRET,env.META_ADS_READ_TOKEN,env.META_ADS_MANAGEMENT_TOKEN])assert.ok(!serialized.includes(secret));
 assert.ok(!serialized.includes("graph.facebook.com"));
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
test("independent write flag/cap remain required, and credentials cannot unlock themselves",async()=>{
 let calls=0;const unreachable=async()=>{calls++;throw Error("unexpected network");};
 await assert.rejects(()=>readVerifiedWriteGate({...env,META_OPERATOR_WRITE_ENABLED:""},unreachable),/locked/);
 await assert.rejects(()=>readVerifiedWriteGate({...env,META_OPERATOR_PORTFOLIO_CAP_MYR:"10100"},unreachable),/cap/);
 await assert.rejects(()=>readVerifiedWriteGate({...env,META_APP_SECRET:undefined},unreachable),/MISSING_SERVER_CONFIGURATION/);
 assert.equal(calls,0);
});
test("verified write configuration preserves the cap and makes no provider mutations",async()=>{
 const payload=debug();payload.data.expires_at=Math.floor(Date.now()/1000)+3600;
 payload.data.data_access_expires_at=Math.floor(Date.now()/1000)+7200;
 const {transport,calls}=fakeProvider({debug:payload});
 const gate=await readVerifiedWriteGate(env,transport);
 assert.equal(gate.portfolioCapMYR,100);assert.equal(gate.token,env.META_ADS_MANAGEMENT_TOKEN);
 assert.equal(calls.length,3);assert.ok(calls.every(call=>call.init.method==="GET"));
});
test("budget monitor never issues a pause when provider credential verification fails",async()=>{
 const payload=debug();payload.data.app_id="999999999999";
 const {transport,calls}=fakeProvider({debug:payload});
 await assert.rejects(()=>pauseOnlyWhenAtCap({account_id:FIXED_META_ACCOUNT,
  meta_campaign_id:"123456789012345",budget_cap_myr:100,authorized_at:new Date().toISOString()},transport,env),/TOKEN_APP_MISMATCH/);
 assert.equal(calls.length,1);assert.ok(calls.every(call=>call.init.method==="GET"));
});
