import test from "node:test";
import assert from "node:assert/strict";
import { createRestrictedLineageReadOnlyProbe, BciLineageLoginProbeDenied } from "../lib/bci/neon-lineage-login-probe.ts";
import { EXPECTED_LINEAGE_POLICY_FINGERPRINTS } from "../lib/bci/neon-lineage-writer.ts";
const P="11111111-1111-4111-8111-111111111111",T="22222222-2222-4222-8222-222222222222";
const scope={principalId:P,tenantId:T,product:"demand"};
const identity={roleName:"bci_dev_lineage_writer",sessionRoleName:"bci_dev_lineage_writer",
  canLogin:true,inherits:false,superuser:false,bypassRls:false,canCreateRole:false,
  canCreateDb:false,canReplicate:false,parentRoles:0};
const posture={databaseName:"bros_intelligence_dev",forcedTables:3,readNodes:true,
  insertNodes:true,readEdges:true,insertEdges:true,noNodeMutation:true,noEdgeMutation:true,
  noFullMembershipRead:true,membershipColumns:true,noMembershipMutation:true,
  noEvidenceAccess:true,noApprovalAccess:true,noSchemaCreate:true,noDbCreate:true,
  policyCount:5,policyFingerprints:EXPECTED_LINEAGE_POLICY_FINGERPRINTS};
function harness({role=identity,acl=posture,leak=false,dbError=false}={}) {
  const calls=[];let principal,tenant,product;
  const transaction=async fn=>fn(async(sql,params)=>{
    calls.push({sql,params});
    if(dbError)throw Error("postgres://secret-sentinel");
    if(sql.includes('AS "roleName"'))return {rows:[role]};
    if(sql.includes('AS "forcedTables"'))return {rows:[acl]};
    if(sql.includes("set_config('bci.principal_id'")){[principal,tenant,product]=params;return {rows:[]};}
    if(sql.includes("FROM bci_dev.tenant_memberships"))return {rows:[{count:leak||(
      principal===P&&tenant===T&&product==="demand")?1:0}]};
    throw Error("unexpected SQL");
  });
  return {probe:createRestrictedLineageReadOnlyProbe(transaction),calls};
}
test("direct restricted lineage login + nonempty membership and negative scope are read-only",async()=>{
  const h=harness(),r=await h.probe(scope);
  assert.deepEqual(r,{directLineageLoginVerified:true,leastPrivilegeAndForcedRlsVerified:true,
    activeMembershipVerified:true,negativeTenantPrincipalProductVerified:true,lineageAppended:false});
  assert.equal(h.calls.filter(x=>x.sql.includes("FROM bci_dev.tenant_memberships")).length,5);
  assert.ok(h.calls.every(x=>/^\\s*SELECT/.test(x.sql)));
  assert.ok(!JSON.stringify(r).includes(P));
});
test("administrator impersonation, privilege drift and policy fingerprint drift fail closed",async()=>{
  for(const [role,acl] of [[{...identity,sessionRoleName:"BROS"},posture],
    [{...identity,bypassRls:true},posture],[identity,{...posture,policyCount:6}],
    [identity,{...posture,policyFingerprints:"forged"}],
    [identity,{...posture,noFullMembershipRead:false}]]) {
    const h=harness({role,acl});
    await assert.rejects(h.probe(scope),BciLineageLoginProbeDenied);
    assert.ok(!h.calls.some(x=>x.sql.includes("set_config")));
  }
});
test("foreign membership leakage and provider error fail closed without secrets",async()=>{
  for(const options of [{leak:true},{dbError:true}]) {
    const h=harness(options);
    await assert.rejects(h.probe(scope),e=>{
      assert.ok(e instanceof BciLineageLoginProbeDenied);
      assert.doesNotMatch(e.message,/secret|postgres/i);return true;
    });
  }
});
test("untrusted scope cannot start a database transaction",async()=>{
  for(const bad of [{...scope,product:"content"},{...scope,tenantId:"BROS"},
    {...scope,admin:true},null]) {
    let calls=0;
    const p=createRestrictedLineageReadOnlyProbe(async()=>{calls++;throw Error("unexpected");});
    await assert.rejects(p(bad),BciLineageLoginProbeDenied);
    assert.equal(calls,0);
  }
});
