import test from "node:test";
import assert from "node:assert/strict";
import {readDemandOperatorSnapshot} from "../lib/demand/meta-operator-snapshot.ts";
const now="2026-11-09T02:00:00.000Z";
const scope={principalId:"principal_123",tenantId:"tenant_12345",accountId:"act_1997776120879476",permission:"DEMAND_META_READ",verifiedAt:now};
const request={accountId:scope.accountId,apiVersion:"v26.0",since:"2026-11-01",until:"2026-11-07",objects:[{objectId:"120251345756090697",kind:"campaign"}]};
const token="synthetic-credential-not-a-real-token";
const clock=()=>new Date(now);
const denied=/BROS_DEMAND_OPERATOR_READ_DENIED/;
function harness(override={}) {
 let credentials=0,network=0;
 const resolver=async()=>override.scope===undefined?scope:override.scope;
 const secret=async()=>{credentials++;return token;};
 const transport=async(url,init)=>{
  network++;
  assert.equal(init.method,"GET");assert.equal(init.redirect,"error");assert.equal(init.cache,"no-store");
  assert.equal(init.headers.Authorization,`Bearer ${token}`);assert.equal(url.includes(token),false);
  if(url.includes("/insights?"))return {ok:true,json:async()=>({data:[]})};
  return {ok:true,json:async()=>({id:request.objects[0].objectId,account_id:scope.accountId.slice(4),configured_status:"PAUSED",effective_status:"PAUSED"})};
 };
 return {resolver,secret,transport,counts:()=>({credentials,network})};
}
test("authorized bounded snapshot preserves NO_ROWS_NOT_ZERO and read-only status",async()=>{
 const h=harness();const r=await readDemandOperatorSnapshot(request,h.resolver,h.secret,h.transport,clock);
 assert.equal(r.insights.state,"NO_ROWS_NOT_ZERO");assert.equal(r.insights.spend,null);
 assert.equal(r.status.rows[0].effectiveStatus,"PAUSED");assert.equal(r.executionAllowed,false);
 assert.equal(r.observedAt,now);assert.deepEqual(h.counts(),{credentials:1,network:2});
});
test("missing, revoked, cross-account, stale and future membership deny before credentials",async()=>{
 for(const s of [null,{...scope,permission:"REVOKED"},{...scope,accountId:"act_123456789"},
  {...scope,verifiedAt:"2026-11-09T01:58:00.000Z"},{...scope,verifiedAt:"2026-11-09T02:01:00.000Z"}]){
  const h=harness({scope:s});await assert.rejects(readDemandOperatorSnapshot(request,h.resolver,h.secret,h.transport,clock),denied);
  assert.deepEqual(h.counts(),{credentials:0,network:0});
 }
});
test("duplicate, malformed and over-limit objects deny before credential retrieval",async()=>{
 for(const objects of [[...request.objects,...request.objects],[{objectId:"bad/id",kind:"campaign"}],Array(21).fill(request.objects[0]),[]]){
  const h=harness();await assert.rejects(readDemandOperatorSnapshot({...request,objects},h.resolver,h.secret,h.transport,clock),denied);
  assert.deepEqual(h.counts(),{credentials:0,network:0});
 }
});
test("provider error returns no partial snapshot and redacts provider message",async()=>{
 const h=harness();let count=0;
 const broken=async(url)=>{count++;if(url.includes("/insights?"))return {ok:true,json:async()=>({data:[]})};throw Error("SECRET_PROVIDER_DIAGNOSTIC");};
 await assert.rejects(readDemandOperatorSnapshot(request,h.resolver,h.secret,broken,clock),e=>e.message==="BROS_DEMAND_OPERATOR_READ_DENIED");
 assert.equal(count,2);
});