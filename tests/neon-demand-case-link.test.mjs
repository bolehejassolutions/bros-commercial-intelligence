import test from "node:test";
import assert from "node:assert/strict";
import {createAuthenticatedDemandReceiptCaseLink} from "../lib/bci/neon-demand-case-link.ts";
const id="11111111-1111-4111-8111-111111111111";
const tenant="22222222-2222-4222-8222-222222222222";
const receipt="4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const caseId="33333333-3333-4333-8333-333333333333";
const grant={principalId:id,tenantId:tenant,product:"demand",active:true};
const role={roleName:"bci_dev_evidence_writer_restricted",sessionRoleName:"bci_dev_evidence_writer_restricted",
 canLogin:true,bypassRls:false,superuser:false,inherits:false,parentRoles:0};
const posture={databaseName:"bros_intelligence_dev",forcedRls:true,appendOnly:true,
 noSchemaCreate:true,noDbCreate:true,noLineage:true,noApprovals:true,policyCount:4,boundPolicyCount:4};
function harness(opts={}){
 let calls=[],commits=0,inserted=opts.replay?false:true;
 const deps={
  authenticate:async()=>opts.badPrincipal?null:{userId:id,authenticated:true},
  membershipsFor:async()=>opts.revoked?[]:[grant],
  transaction:async fn=>{const out=await fn(async(sql,args)=>{
   calls.push({sql,args});
   if(sql.includes('rolcanlogin AS'))return {rows:[opts.admin?{...role,roleName:"BROS"}:role]};
   if(sql.includes('AS "policyCount"'))return {rows:[opts.badAcl?{...posture,appendOnly:false}:posture]};
   if(sql.includes('AS "activeCount"'))return {rows:[{activeCount:opts.revoked?0:1}]};
   if(sql.includes('FROM bci_dev.evidence'))return {rows:opts.foreign?[]:[{id:receipt,completeness:"unverified",provider:"meta_ads"}]};
   if(sql.includes('INSERT INTO bci_dev.cases'))return {rows:inserted?[{id:caseId}]:[]};
   if(sql.includes('FROM bci_dev.cases'))return {rows:[{id:caseId,title:"Historical Meta evidence — review required",question:"Which observations are supported by this persisted Meta snapshot?",status:"REVIEW"}]};
   if(sql.includes('AS "linkCount"'))return {rows:[{linkCount:1}]};
   return {rows:[]};
  });commits++;return out;},
 };
 return {deps,calls,commits:()=>commits};
}
test("one signed scoped receipt becomes review-only case/link, exact replay",async()=>{
 for(const replay of [false,true]){
  const h=harness({replay});
  const out=await createAuthenticatedDemandReceiptCaseLink(h.deps)(receipt);
  assert.deepEqual(out,{caseId,receiptId:receipt,status:replay?"replayed":"inserted",reviewOnly:true,providerAttested:false});
  assert.equal(h.commits(),1);
  assert.equal(h.calls.filter(c=>c.sql.includes("INSERT INTO bci_dev.case_evidence")).length,1);
  assert.equal(h.calls.filter(c=>c.sql.includes("AS \"activeCount\"")).length,2);
 }
});
test("invalid input, revoked, foreign, admin and ACL mismatch all deny",async()=>{
 for(const opts of [{badPrincipal:true},{revoked:true},{foreign:true},{admin:true},{badAcl:true}]){
  const h=harness(opts);
  await assert.rejects(()=>createAuthenticatedDemandReceiptCaseLink(h.deps)(receipt),/case link denied/);
  assert.equal(h.commits(),0);
 }
 const h=harness();
 await assert.rejects(()=>createAuthenticatedDemandReceiptCaseLink(h.deps)("not-a-uuid"),/case link denied/);
 assert.equal(h.calls.length,0);
});
