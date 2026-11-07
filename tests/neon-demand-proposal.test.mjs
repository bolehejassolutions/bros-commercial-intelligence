import test from "node:test";
import assert from "node:assert/strict";
import {createAuthenticatedDemandProposal,createDemandProposalHttpHandler}
 from "../lib/bci/neon-demand-proposal.ts";
const principal="11111111-1111-4111-8111-111111111111";
const tenant="c0d63101-218d-4b67-9efc-e27b45330963";
const caseId="a474cd88-76a3-4c96-8cde-4fcfea45be83";
const input={hypothesis:"Landing page may need clearer value explanation",
 proposedAction:"Review the existing landing page copy without publishing changes",
 proposedSuccessMetric:"Compare independently observed landing page visits",
 confidence:"low"};
const role={roleName:"bci_dev_evidence_writer_restricted",
 sessionRoleName:"bci_dev_evidence_writer_restricted",canLogin:true,
 bypassRls:false,superuser:false,inherits:false,parentRoles:0};
const posture={databaseName:"bros_intelligence_dev",forcedRls:true,
 canSelect:true,canInsert:true,noMutation:true,noApprovals:true,noLineage:true,
 noSchemaCreate:true,boundPolicies:2};
function harness(options={}){
 const calls=[];let committed=0;let expectedId;
 const deps={
  authenticate:async()=>options.badAuth?null:{userId:principal,authenticated:true},
  membershipsFor:async()=>options.revoked?[]:[{principalId:principal,tenantId:tenant,product:"demand",active:true}],
  transaction:async fn=>{
   const result=await fn(async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('rolcanlogin AS'))return {rows:[options.admin?{...role,roleName:"BROS"}:role]};
    if(sql.includes('AS "boundPolicies"'))return {rows:[options.badAcl?{...posture,canInsert:false}:posture]};
    if(sql.includes('AS "activeCount"'))return {rows:[{activeCount:options.revoked?0:1}]};
    if(sql.includes('FROM bci_dev.cases'))return {rows:options.foreign?[]:[{id:caseId}]};
    if(sql.includes('AS "linkCount"'))return {rows:[{linkCount:options.missingEvidence?0:1}]};
    if(sql.includes('INSERT INTO bci_dev.proposals')){
     expectedId=args[0];return {rows:options.replay?[]:[{id:expectedId}]};
    }
    if(sql.includes('FROM bci_dev.proposals'))return {rows:[{
     id:options.tampered?"00000000-0000-4000-8000-000000000001":expectedId,
     hypothesis:input.hypothesis,proposedAction:input.proposedAction,
     proposedSuccessMetric:input.proposedSuccessMetric,confidence:input.confidence,status:"PROPOSED"}]};
    return {rows:[]};
   });committed++;return result;
  },
 };
 return {deps,calls,committed:()=>committed};
}
test("signed real REVIEW case PROPOSED append and idempotent replay only",async()=>{
 for(const replay of [false,true]){
  const h=harness({replay});
  const result=await createAuthenticatedDemandProposal(h.deps)(input);
  assert.equal(result.caseId,caseId);
  assert.match(result.proposalId,/^[0-9a-f-]{36}$/);
  assert.equal(result.status,replay?"replayed":"inserted");
  assert.equal(result.executionAuthorized,false);
  assert.equal(result.providerAttested,false);
  assert.equal(result.outcomeRecorded,false);
  assert.equal(result.reviewOnly,true);
  assert.equal(h.committed(),1);
  assert.equal(h.calls.filter(c=>c.sql.includes('AS "activeCount"')).length,2);
 }
});
test("revoked, foreign, admin, unbound policy, missing evidence, tampered replay all fail closed",async()=>{
 for(const options of [{badAuth:true},{revoked:true},{foreign:true},{admin:true},
  {badAcl:true},{missingEvidence:true},{tampered:true}]){
  const h=harness(options);
  await assert.rejects(()=>createAuthenticatedDemandProposal(h.deps)(input),/proposal append denied/);
  assert.equal(h.committed(),0);
 }
});
test("invalid product-owned text and privilege-injection fields fail before SQL",async()=>{
 for(const invalid of [{...input,confidence:"verified"},{...input,status:"APPROVED"},
  {...input,tenantId:tenant},{...input,hypothesis:" "},
  {...input,proposedAction:"x".repeat(601)},
  {...input,proposedSuccessMetric:"Action executed\nnow"}]){
  const h=harness();
  await assert.rejects(()=>createAuthenticatedDemandProposal(h.deps)(invalid),/proposal append denied/);
  assert.equal(h.calls.length,0);
 }
});
test("HTTP denies unflagged, unsigned, foreign-origin and arbitrary case identity",async()=>{
 const execute=async()=>({caseId,proposalId:"11111111-1111-4111-8111-111111111111",
  status:"inserted",reviewOnly:true,executionAuthorized:false,
  providerAttested:false,outcomeRecorded:false});
 const request=(origin="https://example.test",body=input)=>
  new Request("https://example.test/api/internal/neon-demand-proposal",{
   method:"POST",headers:{origin,"content-type":"application/json",
    authorization:"Bearer abc.def.ghi"},body:JSON.stringify(body)});
 const off=createDemandProposalHttpHandler({env:()=>({}),execute});
 assert.equal((await off(request())).status,404);
 const on=createDemandProposalHttpHandler({env:()=>({
  VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"feat/neon-bci-dev-ledger-20261025",
  BCI_NEON_DEV_PRIVATE_READS:"enabled",BCI_NEON_DEV_PROPOSAL_WRITES:"enabled"}),execute});
 assert.equal((await on(request())).status,200);
 assert.notEqual((await on(request("https://other.test"))).status,200);
 assert.notEqual((await on(request("https://example.test",{...input,caseId}))).status,200);
});
