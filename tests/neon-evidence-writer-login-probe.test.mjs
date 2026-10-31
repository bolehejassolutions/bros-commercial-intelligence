import test from "node:test";
import assert from "node:assert/strict";
import {
  createRestrictedEvidenceWriterReadOnlyProbe, BciEvidenceWriterProbeDenied,
} from "../lib/bci/neon-evidence-writer-login-probe.ts";
import { RESTRICTED_EVIDENCE_WRITER_POLICIES } from "../lib/bci/neon-evidence-writer-policy-fingerprint.ts";

const PRINCIPAL="11111111-1111-4111-8111-111111111111";
const TENANT="22222222-2222-4222-8222-222222222222";
const scope={principalId:PRINCIPAL,tenantId:TENANT,product:"demand"};
const role={roleName:"bci_dev_evidence_writer_restricted",
  sessionRoleName:"bci_dev_evidence_writer_restricted",
  canLogin:true,inherits:false,superuser:false,bypassRls:false,
  canCreateDb:false,canCreateRole:false,canReplicate:false,parentRoles:0};
const posture={databaseName:"bros_intelligence_dev",forcedTables:2,
  canSelectEvidence:true,canInsertEvidence:true,noEvidenceMutation:true,
  canReadMembershipColumns:true,noMembershipMutation:true,
  noSchemaCreate:true,noDatabaseCreate:true,noApprovalAccess:true,
  requiredPolicies:3};
const denied=/BCI evidence writer login probe denied/;

function harness({identity=role,grants=posture,memberLeak=false,foreignLeak=false,
  fail=false,mutateScope,policyRows}={}) {
  const calls=[]; let scopedTenant=null;
  const transaction=async fn=>{
    mutateScope?.();
    return fn(async(sql,params)=>{
      calls.push({sql,params});
      if(fail) throw new Error("postgresql://secret-sentinel@host/db");
      if(sql.includes('AS "roleName"')) return {rows:[identity]};
      if(sql.includes('AS "forcedTables"')) return {rows:[grants]};
      if(sql.includes("FROM pg_policies")) return {rows:policyRows ?? RESTRICTED_EVIDENCE_WRITER_POLICIES};
      if(sql.includes("set_config('bci.principal_id'")) {
        scopedTenant=params[1];return {rows:[]};
      }
      if(sql.includes("set_config('bci.tenant_id'")) {
        scopedTenant=params[0];return {rows:[]};
      }
      if(sql.includes("FROM bci_dev.tenant_memberships")) return {
        rows:[{count:memberLeak?1:scopedTenant===TENANT?1:0}],
      };
      if(sql.includes("FROM bci_dev.evidence")) return {rows:[{count:foreignLeak?1:0}]};
      return {rows:[]};
    });
  };
  return {probe:createRestrictedEvidenceWriterReadOnlyProbe(transaction),calls};
}

test("restricted direct LOGIN role, current DB, FORCE RLS, membership and scope are checked with no write", async()=>{
  const h=harness();
  const r=await h.probe(scope);
  assert.deepEqual(r,{
    directRestrictedLoginVerified:true,forcedRlsAndPrivilegesVerified:true,
    activeDemandMembershipVerified:true,readOnlyScopeSmokeVerified:true,
    evidenceAppended:false,authenticatedProviderReceiptRecorded:false,
  });
  assert.deepEqual(h.calls.filter(x=>x.sql.includes("FROM bci_dev.tenant_memberships"))
    .map(x=>x.params),[[PRINCIPAL,TENANT],[PRINCIPAL,TENANT],[PRINCIPAL,TENANT]]);
  assert.equal(h.calls.filter(x=>x.sql.includes("set_config")).length,3);
  assert.equal(h.calls.filter(x=>x.sql.includes("FROM bci_dev.evidence")).length,1);
  assert.ok(h.calls.every(x=>/^(?:SELECT|\s*SELECT)/.test(x.sql)));
  assert.ok(!JSON.stringify(r).includes(PRINCIPAL));
  assert.ok(!JSON.stringify(r).includes(TENANT));
});

test("direct LOGIN, role name and privilege drift fail closed", async()=>{
  for(const changed of [
    {identity:{...role,roleName:"bci_dev_evidence_writer",sessionRoleName:"bci_dev_evidence_writer"}},
    {identity:{...role,sessionRoleName:"BROS"}},
    {identity:{...role,bypassRls:true}},
    {identity:{...role,inherits:true}},
    {identity:{...role,parentRoles:1}},
    {identity:{...role,canCreateRole:true}},
    {grants:{...posture,canInsertEvidence:false}},
    {grants:{...posture,noEvidenceMutation:false}},
    {grants:{...posture,forcedTables:1}},
    {grants:{...posture,requiredPolicies:2}},
    {grants:{...posture,canReadMembershipColumns:false}},
    {grants:{...posture,noApprovalAccess:false}},
    {memberLeak:true},
    {foreignLeak:true},
  ]) {
    const h=harness(changed);
    await assert.rejects(h.probe(scope),denied);
    assert.ok(h.calls.every(x=>/^(?:SELECT|\s*SELECT)/.test(x.sql)));
  }
});

test("tenant/principal/product spoofing never starts a transaction",async()=>{
  for(const bad of [
    {...scope,product:"content"}, {...scope,tenantId:"invalid"},
    {...scope,principalId:"BROS"}, {...scope,tenantId:"11111111-1111-4111-8111-111111111111",evil:true},
    null,
  ]){
    let invoked=0;
    const fn=createRestrictedEvidenceWriterReadOnlyProbe(async()=>{invoked++;throw Error("unexpected");});
    await assert.rejects(fn(bad),denied);
    assert.equal(invoked,0);
  }
});

test("scope is copied before transaction async starts",async()=>{
  const mutable={...scope};
  const h=harness({mutateScope:()=>{mutable.tenantId="44444444-4444-4444-8444-444444444444";}});
  const result=await h.probe(mutable);
  assert.equal(result.directRestrictedLoginVerified,true);
  assert.equal(h.calls.find(x=>x.sql.includes("set_config('bci.principal_id'")).params[1],TENANT);
});

test("DB errors never leak password or connection details",async()=>{
  const h=harness({fail:true});
  await assert.rejects(h.probe(scope),e=>{
    assert.ok(e instanceof BciEvidenceWriterProbeDenied);
    assert.doesNotMatch(e.message,/postgres|secret-sentinel|password/i);
    return true;
  });
});

test("policy drift, missing membership check and new PUBLIC policy fail before scope GUC",async()=>{
  const base=RESTRICTED_EVIDENCE_WRITER_POLICIES;
  const altered=[{...base[0],checkHash:"0".repeat(64)},...base.slice(1)];
  const publicExtra=[...base,{...base[1],policyName:"permissive_public",roles:"{public}"}];
  for(const policyRows of [altered,base.slice(0,2),publicExtra]){
    const h=harness({policyRows});
    await assert.rejects(h.probe(scope),denied);
    assert.ok(!h.calls.some(x=>x.sql.includes("set_config")));
  }
});
