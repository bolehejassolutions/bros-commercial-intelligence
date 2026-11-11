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
test("malformed calendar windows and unexpected request fields deny before secrets",async()=>{
 const cases=[
  {...request,since:"2026-02-30"},
  {...request,until:"2026-13-01"},
  {...request,since:"2026-11-08",until:"2026-11-07"},
  {...request,since:"2026-01-01",until:"2026-02-03"},
  {...request,unexpectedTenant:"tenant_12345"},
  {...request,objects:[{...request.objects[0],approved:true}]},
  {...request,objects:[null]},
 ];
 for(const candidate of cases){
  const h=harness();
  await assert.rejects(readDemandOperatorSnapshot(candidate,h.resolver,h.secret,h.transport,clock),denied);
  assert.deepEqual(h.counts(),{credentials:0,network:0});
 }
});

test("canonical leap-day date is accepted while invalid leap-day is denied before credentials",async()=>{
 const h=harness();
 const accepted=await readDemandOperatorSnapshot({...request,since:"2024-02-29",until:"2024-03-01"},h.resolver,h.secret,h.transport,clock);
 assert.equal(accepted.executionAllowed,false);
 assert.deepEqual(h.counts(),{credentials:1,network:2});
 const invalid=harness();
 await assert.rejects(readDemandOperatorSnapshot({...request,since:"2025-02-29",until:"2025-03-01"},invalid.resolver,invalid.secret,invalid.transport,clock),denied);
 assert.deepEqual(invalid.counts(),{credentials:0,network:0});
});

test("revoked, replaced or stale membership after provider reads never releases a snapshot",async()=>{
 for(const replacement of [null,{...scope,permission:"REVOKED"},
   {...scope,tenantId:"tenant_other"}, {...scope,principalId:"principal_other"},
   {...scope,verifiedAt:"2026-11-09T01:58:00.000Z"}]){
  const h=harness();let calls=0;
  const resolver=async()=>++calls===1?scope:replacement;
  await assert.rejects(readDemandOperatorSnapshot(request,resolver,h.secret,h.transport,clock),denied);
  assert.equal(calls,2);
  assert.deepEqual(h.counts(),{credentials:1,network:2});
 }
});
test("membership revalidation failure is sanitized and does not leak observations",async()=>{
 const h=harness();let calls=0;
 await assert.rejects(readDemandOperatorSnapshot(request,async()=>{
  if(++calls===1)return scope;
  throw Error("PRIVATE_MEMBERSHIP_DRIVER_DETAILS");
 },h.secret,h.transport,clock),e=>e.message==="BROS_DEMAND_OPERATOR_READ_DENIED");
 assert.equal(calls,2);
});

test("post-read fresh canonical membership succeeds, malformed timestamp fails closed",async()=>{
 const h=harness();let calls=0;
 const resolver=async()=>{calls++;return {...scope,verifiedAt:now};};
 const result=await readDemandOperatorSnapshot(request,resolver,h.secret,h.transport,clock);
 assert.equal(calls,2);
 assert.equal(result.insights.state,"NO_ROWS_NOT_ZERO");
 assert.equal(result.executionAllowed,false);
 for(const malformed of ["2026-11-09T02:00:00ZEXTRA","2026-11-09T02:00:00+00:00","2026-11-09T02:00:00.000Z\\n"]){
  let checks=0;const fixture=harness();
  await assert.rejects(readDemandOperatorSnapshot(request,async()=>++checks===1?scope:{...scope,verifiedAt:malformed},fixture.secret,fixture.transport,clock),denied);
  assert.equal(checks,2);
 }
});

test("post-read membership timestamp regression and backwards clock deny release",async()=>{
 const h=harness();let checks=0;
 const newer={...scope,verifiedAt:"2026-11-09T02:00:30.000Z"};
 const older={...scope,verifiedAt:"2026-11-09T02:00:00.000Z"};
 await assert.rejects(readDemandOperatorSnapshot(request,async()=>++checks===1?newer:older,h.secret,h.transport,
  ()=>new Date("2026-11-09T02:00:30.000Z")),denied);
 assert.equal(checks,2);
 const clockHarness=harness();let ticks=0;
 await assert.rejects(readDemandOperatorSnapshot(request,clockHarness.resolver,clockHarness.secret,clockHarness.transport,
  ()=>new Date(++ticks===1?"2026-11-09T02:00:10.000Z":"2026-11-09T02:00:09.000Z")),denied);
 assert.equal(ticks,2);
});

test("direct snapshot accepts 31 inclusive days and rejects 32 before credentials or Meta transport",async()=>{
 const allowed=harness();
 const within=await readDemandOperatorSnapshot({...request,since:"2026-10-01",until:"2026-10-31"},allowed.resolver,allowed.secret,allowed.transport,clock);
 assert.equal(within.insights.state,"NO_ROWS_NOT_ZERO");
 assert.deepEqual(allowed.counts(),{credentials:1,network:2});
 const deniedWindow=harness();
 await assert.rejects(readDemandOperatorSnapshot({...request,since:"2026-10-01",until:"2026-11-01"},deniedWindow.resolver,deniedWindow.secret,deniedWindow.transport,clock),denied);
 assert.deepEqual(deniedWindow.counts(),{credentials:0,network:0});
});
