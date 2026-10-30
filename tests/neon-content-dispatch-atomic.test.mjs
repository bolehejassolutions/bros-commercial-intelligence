import test from "node:test";
import assert from "node:assert/strict";
import {createPgContentDispatchAtomicReservation,createPgContentReservationTransaction}
  from "../lib/bci/neon-content-dispatch-atomic.ts";
const tenantId="22222222-2222-4222-8222-222222222222";
const principalId="11111111-1111-4111-8111-111111111111";
const reservationId="33333333-3333-4333-8333-333333333333";
const args={tenantId,principalId,product:"content",dispatchIntentId:"intent-1",
  approvalId:"approval-1",bindingSha256:"a".repeat(64)};
const role={roleName:"bci_dev_content_reserver",sessionRoleName:"bci_dev_content_reserver",
  canLogin:true,bypassRls:false,superuser:false,canCreateRole:false,canCreateDb:false,
  canReplicate:false,inherits:false,parentRoles:0};
const posture={databaseName:"bros_intelligence_dev",forcedRls:true,noSchemaCreate:true,
  noDbCreate:true,canReadMembership:true,canReadApproval:true,canReadRevocation:true,
  canReadReservations:true,canReserve:true,noMembershipWrites:true,noApprovalWrites:true,
  noRevocationWrites:true,noMutation:true,noOtherBci:true};
const denied=/BCI private content reservation denied/;
function harness({r=role,p=posture,rows=[{reservationId}],existing=0,failAt=0}={}) {
  const calls=[];let i=0;
  const reserve=createPgContentDispatchAtomicReservation(async fn=>fn(async(sql,params)=>{
    calls.push({sql,params});i++;if(i===failAt)throw Error("driver secret redacted");
    if(i===1)return {rows:[r]};if(i===2)return {rows:[p]};if(i===3)return {rows:[{}]};
    if(i===4)return {rows};if(i===5)return {rows:[{existingCount:existing}]};
    throw Error("unexpected SQL");
  }));
  return {reserve,calls};
}
test("atomic SQL binds approval, membership, revocation and unique intent; no provider SENT",async()=>{
  const h=harness();assert.deepEqual(await h.reserve(args),{status:"acquired",reservationId});
  assert.equal(h.calls.length,4);
  assert.match(h.calls[3].sql,/active_memberships AS MATERIALIZED/);
  assert.match(h.calls[3].sql,/expires_at > clock_timestamp\(\)/);
  assert.match(h.calls[3].sql,/NOT EXISTS \(SELECT 1 FROM bci_dev.content_dispatch_revocations/);
  assert.match(h.calls[3].sql,/ON CONFLICT \(tenant_id,product,dispatch_intent_id\) DO NOTHING/);
  assert.doesNotMatch(h.calls[3].sql,/FOR UPDATE|FOR SHARE/);
  assert.deepEqual(h.calls[3].params,[principalId,"approval-1",tenantId,"intent-1","a".repeat(64)]);
});
test("existing intent cannot return prior receipt or authorize replay",async()=>{
  const h=harness({rows:[],existing:1});
  assert.deepEqual(await h.reserve(args),{status:"already_reserved",reservationId:null});
});
test("missing, expired, revoked or foreign approval is denied",async()=>{
  const h=harness({rows:[],existing:0});await assert.rejects(h.reserve(args),denied);
});
test("admin impersonation, privilege drift and unforced RLS fail closed",async()=>{
  for(const r of [{...role,sessionRoleName:"BROS"},{...role,bypassRls:true},
    {...role,parentRoles:1},{...role,canReplicate:true}]){
    const h=harness({r});await assert.rejects(h.reserve(args),denied);
    assert.equal(h.calls.length,1);
  }
  for(const p of [{...posture,forcedRls:false},{...posture,noOtherBci:false},
    {...posture,canReserve:false},{...posture,noApprovalWrites:false}]){
    const h=harness({p});await assert.rejects(h.reserve(args),denied);
    assert.equal(h.calls.length,2);
  }
});
test("caller product, tenant, approval, binding and role tampering denied before SQL",async()=>{
  for(const q of [{...args,product:"demand"},{...args,tenantId:"tenant-B"},
    {...args,approvalId:"bad space"},{...args,bindingSha256:"B".repeat(64)},
    {...args,role:"BROS"}]){
    const h=harness();await assert.rejects(h.reserve(q),denied);
    assert.equal(h.calls.length,0);
  }
});
test("driver errors and ambiguous results are sanitized and denied",async()=>{
  for(const failAt of [1,2,3,4,5]){
    const h=harness({failAt,rows:[],existing:0});await assert.rejects(h.reserve(args),denied);
  }
  const h=harness({rows:[{reservationId:"not-uuid"}]});
  await assert.rejects(h.reserve(args),denied);
});
test("SERIALIZABLE wrapper commits and destroys failed sessions",async()=>{
  const statements=[];const released=[];
  const pool={connect:async()=>({query:async sql=>{statements.push(sql);return {rows:[]};},
    release:destroy=>released.push(destroy)})};
  const tx=createPgContentReservationTransaction(pool);
  assert.equal(await tx(async query=>{await query("SELECT 1",[]);return "ok";}),"ok");
  assert.equal(statements[0],"BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE");
  assert.equal(statements.at(-1),"COMMIT");assert.deepEqual(released,[false]);
  await assert.rejects(tx(async()=>{throw Error("secret from DB");}),denied);
  assert.equal(statements.at(-1),"ROLLBACK");assert.deepEqual(released,[false,true]);
});
