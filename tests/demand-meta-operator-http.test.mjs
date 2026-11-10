import test from "node:test";
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
 const response=await h.handler(req());assert.equal(response.status,403);
 const body=JSON.stringify(await response.json());assert.ok(!body.includes("sensitive"));
});
test("missing server token denies before any Meta GET",async()=>{
 const h=build({readToken:()=>null});const response=await h.handler(req());
 assert.equal(response.status,403);assert.equal(h.counts().reads,0);
});
