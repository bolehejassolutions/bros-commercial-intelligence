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
  noDbCreate:true,canReadMembership:true,canReadApproval:true,
  noBroadApprovalRead:true,noApprovalProofRead:true,canReadRevocation:true,
  canReadReservations:true,canReserve:true,noMembershipWrites:true,noApprovalWrites:true,
  noRevocationWrites:true,noMutation:true,noOtherBci:true,
  noDefinerExec:true,noOtherSchemaCreate:true,noSequenceAccess:true,noExternalTables:true};
const denied=/BCI private content reservation denied/;
function harness({r=role,p=posture,rows=[{reservationId}],existing=0,failAt=0,
  mode="reserve"}={}) {
  const calls=[];let i=0;
  const tx=async fn=>fn(async(sql,params)=>{
    calls.push({sql,params});i++;if(i===failAt)throw Error("driver secret redacted");
    if(i===1)return {rows:[r]};if(i===2)return {rows:[p]};if(i===3)return {rows:[{}]};
    if(i===4)return {rows};if(i===5)return {rows:[{existingCount:existing}]};
    throw Error("unexpected SQL");
  });
  const reserve=mode==="predispatch_recheck"
    ?createPgContentDispatchAtomicReservation(tx,"predispatch_recheck")
    :createPgContentDispatchAtomicReservation(tx);
  return {reserve,calls};
}
test("atomic SQL binds approval, membership, revocation and unique intent; no provider SENT",async()=>{
  const h=harness();assert.deepEqual(await h.reserve(args),{status:"acquired",reservationId});
  assert.equal(h.calls.length,4);
  for (const guard of ["noDefinerExec","noOtherSchemaCreate","noSequenceAccess","noExternalTables"])
    assert.match(h.calls[1].sql,new RegExp(guard));
  // BCI views (including owner-privilege views) must count as extra grants.
  assert.match(h.calls[1].sql,/n\.nspname='bci_dev' AND t\.relkind IN \('r','p','v','m','f'\)/);
  assert.match(h.calls[1].sql,/noBroadApprovalRead/);
  assert.match(h.calls[1].sql,/noApprovalProofRead/);
  assert.match(h.calls[1].sql,/signed_review_receipt/);
  assert.match(h.calls[1].sql,/signed_admission_receipt/);
  assert.match(h.calls[3].sql,/active_memberships AS MATERIALIZED/);
  assert.match(h.calls[3].sql,/principal_id=\$1::uuid AND tenant_id=\$3::uuid AND product='content'/);
  assert.match(h.calls[3].sql,/expires_at > clock_timestamp\(\)/);
  assert.match(h.calls[3].sql,/NOT EXISTS \(SELECT 1 FROM bci_dev.content_dispatch_revocations/);
  assert.match(h.calls[3].sql,/ON CONFLICT \(tenant_id,product,dispatch_intent_id\) DO NOTHING/);
  assert.doesNotMatch(h.calls[3].sql,/FOR UPDATE|FOR SHARE/);
  assert.deepEqual(h.calls[3].params,[principalId,"approval-1",tenantId,"intent-1","a".repeat(64)]);
});
test("existing intent cannot return prior receipt or authorize replay",async()=>{
  const h=harness({rows:[],existing:1});
  assert.deepEqual(await h.reserve(args),{status:"already_reserved",reservationId:null});
  assert.equal(h.calls.length,5);
  const replay=h.calls[4];
  assert.deepEqual(replay.params,[tenantId,"intent-1",principalId,"approval-1","a".repeat(64)]);
  assert.match(replay.sql,/r.principal_id=\$3::uuid/);
  assert.match(replay.sql,/r.approval_id=\$4::text AND r.binding_sha256=\$5::text/);
  assert.match(replay.sql,/a.expires_at > clock_timestamp\(\)/);
  assert.match(replay.sql,/m.principal_id=\$3::uuid AND m.tenant_id=\$1::uuid/);
  assert.match(replay.sql,/NOT EXISTS \(\s*SELECT 1 FROM bci_dev.content_dispatch_revocations v/);
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
    {...posture,canReserve:false},{...posture,noApprovalWrites:false},
    {...posture,noBroadApprovalRead:false},{...posture,noApprovalProofRead:false},
    {...posture,canReadApproval:false},
    {...posture,noDefinerExec:false},{...posture,noOtherSchemaCreate:false},
    {...posture,noSequenceAccess:false},{...posture,noExternalTables:false}]){
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

test("pre-dispatch rechecks an EXISTING exact reservation via 0014 trigger and returns no publish permit",async()=>{
  const h=harness({mode:"predispatch_recheck",rows:[],existing:1});
  assert.deepEqual(await h.reserve(args),{status:"pre_dispatch_rechecked",
    reservationId:null,providerSent:false,providerAttested:false});
  assert.equal(h.calls.length,5);
  assert.match(h.calls[3].sql,/ON CONFLICT \(tenant_id,product,dispatch_intent_id\) DO NOTHING/);
  assert.match(h.calls[4].sql,/r.principal_id=\$3::uuid/);
});
test("pre-dispatch NEVER creates a missing reservation or permits stale/foreign/revoked claims",async()=>{
  for(const opts of [
    {rows:[{reservationId}],existing:0}, // would create: reject and transaction must rollback
    {rows:[],existing:0}, // wrong principal, expired, revoked or absent
    {rows:[],existing:1,failAt:4}, // DB 0014 active-reviewer trigger rejected
    {rows:[],existing:1,failAt:5}, // driver failure
    {rows:[],existing:1,r:{...role,sessionRoleName:"BROS"}},
    {rows:[],existing:1,p:{...posture,noDefinerExec:false}},
  ]){
    const h=harness({...opts,mode:"predispatch_recheck"});
    await assert.rejects(h.reserve(args),denied);
  }
});

test("reservation pins authorization tuple before asynchronous SQL role and posture checks",async()=>{
  for(const replay of [false,true]){
    const mutable={...args};const calls=[];let count=0;
    const tx=async fn=>fn(async(sql,params)=>{
      calls.push({sql,params});count++;
      if(count===1){
        Object.assign(mutable,{
          tenantId:"44444444-4444-4444-8444-444444444444",
          principalId:"55555555-5555-4555-8555-555555555555",
          product:"demand",dispatchIntentId:"swapped-intent",
          approvalId:"swapped-approval",bindingSha256:"b".repeat(64)
        });
        return {rows:[role]};
      }
      if(count===2)return {rows:[posture]};
      if(count===3)return {rows:[{}]};
      if(count===4)return {rows:replay?[]:[{reservationId}]};
      if(count===5)return {rows:[{existingCount:1}]};
      throw Error("unexpected query");
    });
    const result=await createPgContentDispatchAtomicReservation(tx)(mutable);
    assert.equal(result.status,replay?"already_reserved":"acquired");
    assert.deepEqual(calls[2].params,[principalId,tenantId]);
    assert.deepEqual(calls[3].params,
      [principalId,"approval-1",tenantId,"intent-1","a".repeat(64)]);
    if(replay)assert.deepEqual(calls[4].params,
      [tenantId,"intent-1",principalId,"approval-1","a".repeat(64)]);
  }
});

test("reservation rejects accessor-based caller fields before SQL",async()=>{
  const accessor={...args};
  Object.defineProperty(accessor,"tenantId",{enumerable:true,get(){return tenantId;}});
  const h=harness();await assert.rejects(h.reserve(accessor),denied);
  assert.equal(h.calls.length,0);
});
