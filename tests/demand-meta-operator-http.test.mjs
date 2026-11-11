import test from "node:test";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {createDemandOperatorStatusHandler} from "../lib/demand/meta-operator-http.ts";
const clock="2026-11-11T01:00:00.000Z";
const jwt="Bearer abc.def.ghi";
const url="https://internal.example/api/internal/demand-meta-status?since=2026-11-01&until=2026-11-07";
const token="synthetic-test-only-token-not-live";
const id="120251345756090697";
const build=(override={})=>{
 let reads=0,auth=0,tokenReads=0;
 const deps={
  enabled:()=>true,accountId:"act_1997776120879476",campaignId:id,apiVersion:"v26.0",
  authorize:async()=>{auth++;return {principalId:"principal_123",tenantId:"tenant_12345"};},
  readToken:()=>{tokenReads++;return token;},
  now:()=>new Date(clock),
  transport:async(u,init)=>{
   reads++;assert.equal(init.method,"GET");assert.equal(init.redirect,"error");
   assert.equal(init.cache,"no-store");assert.equal(init.headers.Authorization,"Bearer "+token);
   assert.equal(u.includes(token),false);
   if(u.includes("/insights?"))return {ok:true,json:async()=>({data:[]})};
   return {ok:true,json:async()=>({id,account_id:"1997776120879476",configured_status:"PAUSED",effective_status:"PAUSED"})};
  },...override
 };
 return {handler:createDemandOperatorStatusHandler(deps),counts:()=>({reads,auth,tokenReads})};
};
const req=(target=url,method="GET",headers={authorization:jwt})=>new Request(target,{method,headers});
test("authenticated GET returns pinned campaign status and NO_ROWS_NOT_ZERO without write authority",async()=>{
 const h=build();const response=await h.handler(req());const data=await response.json();
 assert.equal(response.status,200);assert.equal(data.insights.state,"NO_ROWS_NOT_ZERO");
 assert.equal(data.insights.spend,null);assert.equal(data.status.rows[0].effectiveStatus,"PAUSED");
 assert.equal(data.executionAllowed,false);assert.equal(data.verifiedPaidOrders,null);
 assert.equal(response.headers.get("cache-control"),"private, no-store, max-age=0");
 assert.ok(!JSON.stringify(data).includes(token));assert.ok(!JSON.stringify(data).includes("principal_123"));
 assert.deepEqual(h.counts(),{reads:2,auth:2,tokenReads:1});
});
test("default OFF prevents authentication and provider access",async()=>{
 const h=build({enabled:()=>false});assert.equal((await h.handler(req())).status,404);
 assert.deepEqual(h.counts(),{reads:0,auth:0,tokenReads:0});
});
test("all non-GET verbs and invalid authorization fail without provider access",async()=>{
 for(const method of ["POST","PUT","PATCH","DELETE","OPTIONS","HEAD"]){
  const h=build();assert.equal((await h.handler(req(url,method))).status,405);
  assert.deepEqual(h.counts(),{reads:0,auth:0,tokenReads:0});
 }
 for(const header of [{}, {authorization:"Bearer invalid"},{authorization:jwt,"x-meta-token":"untrusted"}]){
  const h=build();assert.notEqual((await h.handler(req(url,"GET",header))).status,200);
  assert.deepEqual(h.counts(),{reads:0,auth:0,tokenReads:0});
 }
});
test("untrusted account, campaign, duplicate query or unexpected params are rejected before auth",async()=>{
 for(const target of [url+"&account_id=123456",url+"&campaign_id="+id,url+"&since=2026-11-02",url+"&token=secret"]){
  const h=build();assert.equal((await h.handler(req(target))).status,400);
  assert.deepEqual(h.counts(),{reads:0,auth:0,tokenReads:0});
 }
});
test("revoked membership during post-read revalidation never exposes a partial result",async()=>{
 let calls=0;
 const h=build({authorize:async()=>{if(++calls===2)throw Error("sensitive membership error");return {principalId:"principal_123",tenantId:"tenant_12345"};}});
 const response=await h.handler(req());assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:"DEMAND_STATUS_DENIED"});
 assert.equal(h.counts().reads,2);assert.equal(calls,2);
});
test("provider failure is sanitized; no partial results or token leakage",async()=>{
 const h=build({transport:async()=>{throw Error("sensitive provider token");}});
 const response=await h.handler(req());assert.equal(response.status,502);
 assert.deepEqual(await response.json(),{error:"DEMAND_META_PROVIDER_UNAVAILABLE"});
});
test("missing server token denies before any Meta GET",async()=>{
 const h=build({readToken:()=>null});const response=await h.handler(req());
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:"DEMAND_META_CREDENTIAL_UNAVAILABLE"});assert.equal(h.counts().reads,0);
});

test("server-pinned campaign, ad set and ad are observed together with no caller-controlled IDs",async()=>{
 const campaign="120251345756090697",adset="120251345761440697",ad="120251348178960697";
 const seen=[];
 const h=build({adsetId:adset,adId:ad,transport:async(u,init)=>{
  assert.equal(init.method,"GET");assert.equal(init.redirect,"error");seen.push(u);
  if(u.includes("/insights?"))return {ok:true,json:async()=>({data:[]})};
  const objectId=new URL(u).pathname.split("/").at(-1);
  assert.ok([campaign,adset,ad].includes(objectId));
  return {ok:true,json:async()=>({id:objectId,account_id:"1997776120879476",configured_status:"PAUSED",effective_status:"PAUSED"})};
 }});
 const response=await h.handler(req());const body=await response.json();
 assert.equal(response.status,200);
 assert.deepEqual(body.status.rows.map(x=>[x.kind,x.objectId]),[["campaign",campaign],["adset",adset],["ad",ad]]);
 assert.equal(body.insights.state,"NO_ROWS_NOT_ZERO");assert.equal(body.executionAllowed,false);
 assert.equal(seen.length,4);
});
test("invalid server-pinned ad object fails closed before any provider request",async()=>{
 const h=build({adsetId:"invalid"});
 const response=await h.handler(req());
 assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:"DEMAND_STATUS_DENIED"});
 assert.deepEqual(h.counts(),{reads:0,auth:1,tokenReads:0});
});
test("caller cannot override server-pinned ad set or ad IDs",async()=>{
 const h=build({adsetId:"120251345761440697",adId:"120251348178960697"});
 for(const extra of ["adset_id=999999999","ad_id=999999999"]){
  const response=await h.handler(req(url+"&"+extra));assert.equal(response.status,400);
 }
 assert.deepEqual(h.counts(),{reads:0,auth:0,tokenReads:0});
});

test("concurrent Meta observations are capped at two; saturation makes zero extra provider calls",async()=>{
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 let started=0;
 const h=build({transport:async(u)=>{
  started++;
  await gate;
  if(u.includes("/insights?"))return {ok:true,json:async()=>({data:[]})};
  return {ok:true,json:async()=>({id,account_id:"1997776120879476",configured_status:"PAUSED",effective_status:"PAUSED"})};
 }});
 const first=h.handler(req()),second=h.handler(req());
 // Await until both reads have entered the controlled transport.
 for(let i=0;i<100&&started<2;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(started,2);
 const busy=await h.handler(req());
 assert.equal(busy.status,429);
 assert.deepEqual(await busy.json(),{error:"DEMAND_STATUS_BUSY"});
 assert.equal(started,2);
 release();
 assert.equal((await first).status,200);
 assert.equal((await second).status,200);
 assert.equal((await h.handler(req())).status,200);
});
test("failed Meta read releases concurrency slot for a subsequent request",async()=>{
 let calls=0;
 const h=build({transport:async(u)=>{
  calls++;
  if(calls===1)throw Error("synthetic provider failure");
  if(u.includes("/insights?"))return {ok:true,json:async()=>({data:[]})};
  return {ok:true,json:async()=>({id,account_id:"1997776120879476",configured_status:"PAUSED",effective_status:"PAUSED"})};
 }});
 assert.equal((await h.handler(req())).status,502);
 assert.equal((await h.handler(req())).status,200);
});

// Regression: the deployed runtime must actually pass pinned optional IDs to the tested handler.
test("operator runtime wires optional server-owned ad set/ad IDs and rejects malformed configured IDs",()=>{
 const runtime=readFileSync(new URL("../lib/demand/meta-direct-runtime.ts",import.meta.url),"utf8");
 const operator=runtime.slice(runtime.indexOf("const operatorStatusHandler=createDemandOperatorStatusHandler("));
 assert.match(operator,/adsetId:process\.env\.BROS_DEMAND_META_ADSET_ID/);
 assert.match(operator,/adId:process\.env\.BROS_DEMAND_META_AD_ID/);
 assert.match(runtime,/process\.env\.BROS_DEMAND_META_ADSET_ID === undefined \|\| digits\.test\(process\.env\.BROS_DEMAND_META_ADSET_ID\)/);
 assert.match(runtime,/process\.env\.BROS_DEMAND_META_AD_ID === undefined \|\| digits\.test\(process\.env\.BROS_DEMAND_META_AD_ID\)/);
 assert.doesNotMatch(operator,/request\.headers\.(get|has)\(["']x-(adset|ad)-id/);
});

test("invalid and overlong reporting windows are rejected before authentication or Meta reads",async()=>{
 const bad=[
  "since=2026-02-30&until=2026-03-01",
  "since=2026-11-08&until=2026-11-07",
  "since=2026-01-01&until=2026-02-02",
  "since=2026-11-01T00:00:00Z&until=2026-11-07",
  "since=2026-11-01&until=not-a-date"
 ];
 for(const query of bad){
  const h=build();
  const response=await h.handler(req("https://internal.example/api/internal/demand-meta-status?"+query));
  assert.equal(response.status,400,query);
  assert.deepEqual(await response.json(),{error:"INVALID_REPORTING_WINDOW"});
  assert.deepEqual(h.counts(),{reads:0,auth:0,tokenReads:0});
 }
});

test("Insights accepts 31 inclusive historical days and rejects future and 32-day windows before authorization",async()=>{
 const accepted="https://internal.example/api/internal/demand-meta-status?since=2026-10-01&until=2026-10-31";
 const valid=build();assert.equal((await valid.handler(req(accepted))).status,200);
 for(const query of [
  "since=2026-10-01&until=2026-11-01",
  "since=2026-11-11&until=2026-11-12",
  "since=2026-12-01&until=2026-12-01"
 ]){
  const h=build();
  const response=await h.handler(req("https://internal.example/api/internal/demand-meta-status?"+query));
  assert.equal(response.status,400,query);
  assert.deepEqual(await response.json(),{error:"INVALID_REPORTING_WINDOW"});
  assert.deepEqual(h.counts(),{reads:0,auth:0,tokenReads:0});
 }
});

test("provider outage is distinct from tenant denial, while revalidation failures remain 403",async()=>{
 const provider=build({transport:async()=>{throw Error("secret provider detail");}});
 const outage=await provider.handler(req());assert.equal(outage.status,502);
 assert.equal(outage.headers.get("cache-control"),"private, no-store, max-age=0");
 assert.ok(!JSON.stringify(await outage.json()).includes("secret"));
 let checks=0;
 const revoked=build({authorize:async()=>{if(++checks===2)throw Error("revoked");return {principalId:"p",tenantId:"t"};}});
 assert.equal((await revoked.handler(req())).status,403);
});

test("Meta non-2xx responses are provider failures, never tenant denials or leaked bodies",async()=>{
 for(const status of [400,401,403,429,500,503]){
  let calls=0;
  const h=build({transport:async()=>{calls++;return {ok:false,status,json:async()=>{throw Error("provider secret must not be parsed");}};}});
  const response=await h.handler(req());
  assert.equal(response.status,status===429?503:502,"provider HTTP "+status);
  assert.deepEqual(await response.json(),{error:status===429?"DEMAND_META_PROVIDER_RATE_LIMITED":"DEMAND_META_PROVIDER_UNAVAILABLE"});
  assert.equal(calls,1);
 }
});
test("Meta non-2xx after successful Insights also fails atomically",async()=>{
 let calls=0;
 const h=build({transport:async(u)=>{
  calls++;
  if(u.includes("/insights?"))return {ok:true,json:async()=>({data:[]})};
  return {ok:false,status:403,json:async()=>{throw Error("secret error");}};
 }});
 const response=await h.handler(req());
 assert.equal(response.status,502);
 assert.deepEqual(await response.json(),{error:"DEMAND_META_PROVIDER_UNAVAILABLE"});
 assert.equal(calls,2);
});


test("Meta malformed JSON after HTTP 200 is a sanitized provider failure, not tenant denial",async()=>{
 for(const stage of ["insights","object"]){
  let calls=0;
  const h=build({transport:async(u)=>{
   calls++;
   if(stage==="insights"||!u.includes("/insights?"))return {ok:true,json:async()=>{throw Error("synthetic sensitive provider JSON");}};
   return {ok:true,json:async()=>({data:[]})};
  }});
  const response=await h.handler(req());
  assert.equal(response.status,502,stage);
  assert.deepEqual(await response.json(),{error:"DEMAND_META_PROVIDER_UNAVAILABLE"});
  assert.equal(calls,stage==="insights"?1:2);
 }
});

test("Meta HTTP 200 malformed Insights schema is a sanitized 502, never a tenant denial",async()=>{
 let providerCalls=0;
 const h=build({transport:async()=>{providerCalls++;return {ok:true,json:async()=>({data:[{spend:"not-a-number"}]})};}});
 const response=await h.handler(req());
 assert.equal(response.status,502);
 assert.deepEqual(await response.json(),{error:"DEMAND_META_PROVIDER_UNAVAILABLE"});
 assert.equal(providerCalls,1);
 assert.deepEqual(h.counts(),{reads:0,auth:1,tokenReads:1});
});
test("Meta HTTP 200 malformed object status is a sanitized 502 after valid Insights",async()=>{
 let providerCalls=0;
 const h=build({transport:async(u)=>{providerCalls++;return u.includes("/insights?")
  ?{ok:true,json:async()=>({data:[]})}
  :{ok:true,json:async()=>({id:"wrong-object",effective_status:"PAUSED"})};}});
 const response=await h.handler(req());
 assert.equal(response.status,502);
 assert.deepEqual(await response.json(),{error:"DEMAND_META_PROVIDER_UNAVAILABLE"});
 assert.equal(providerCalls,2);
 assert.deepEqual(h.counts(),{reads:0,auth:1,tokenReads:1});
});
test("post-provider tenant revocation remains 403 rather than a provider 502",async()=>{
 let checks=0;
 const h=build({authorize:async()=>{if(++checks===2)throw Error("revoked");return {principalId:"principal_123",tenantId:"tenant_12345"};}});
 const response=await h.handler(req());
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:"DEMAND_STATUS_DENIED"});
 assert.equal(h.counts().reads,2);
 assert.equal(checks,2);
});

test("Meta provider rate limit is sanitized and recovery does not retain a stale rate-limit state",async()=>{
 let calls=0;
 const h=build({transport:async(u)=>{
  calls++;
  if(calls===1)return {ok:false,status:429,json:async()=>{throw Error("private provider retry details");}};
  if(u.includes("/insights?"))return {ok:true,json:async()=>({data:[]})};
  return {ok:true,json:async()=>({id,account_id:"1997776120879476",configured_status:"PAUSED",effective_status:"PAUSED"})};
 }});
 const limited=await h.handler(req());
 assert.equal(limited.status,503);
 assert.deepEqual(await limited.json(),{error:"DEMAND_META_PROVIDER_RATE_LIMITED"});
 assert.equal(limited.headers.get("cache-control"),"private, no-store, max-age=0");
 const recovered=await h.handler(req());
 assert.equal(recovered.status,200);
 assert.equal((await recovered.json()).insights.state,"NO_ROWS_NOT_ZERO");
 assert.equal(calls,3);
});

test("invalid server Meta tokens fail closed without contacting provider",async()=>{
 for(const invalid of ["", " ", "short-token", "synthetic token", "abc\ndef", "abc\rdef", "abc\tdef", "é", "x".repeat(4097), null]){
  const h=build({readToken:()=>invalid});
  const response=await h.handler(req());
  assert.equal(response.status,503,JSON.stringify(invalid)?.slice(0,40));
  assert.deepEqual(await response.json(),{error:"DEMAND_META_CREDENTIAL_UNAVAILABLE"});
  assert.deepEqual(h.counts(),{reads:0,auth:1,tokenReads:0});
 }
 const validToken="opaque-ASCII_+/=~token";
 let validCalls=0;
 const valid=build({readToken:()=>validToken,transport:async(u,init)=>{
  validCalls++;
  assert.equal(init.method,"GET");
  assert.equal(init.headers.Authorization,"Bearer "+validToken);
  assert.equal(u.includes(validToken),false);
  if(u.includes("/insights?"))return {ok:true,json:async()=>({data:[]})};
  return {ok:true,json:async()=>({id,account_id:"1997776120879476",configured_status:"PAUSED",effective_status:"PAUSED"})};
 }});
 assert.equal((await valid.handler(req())).status,200);
 assert.equal(validCalls,2);
});
