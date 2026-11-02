import test from "node:test";
import assert from "node:assert/strict";
import { assessInternalReadiness } from "../lib/bci/internal-readiness.ts";
const tenantId="11111111-1111-4111-8111-111111111111";
const empty={tenantId,contentId:"draft-1",contentEvidence:[],experimentId:"experiment-1",demandEvidence:[]};
test("internal v1 never passes with empty evidence or omitted security gates",()=>{
 const r=assessInternalReadiness(empty);
 assert.equal(r.internalV1Ready,false);
 assert.equal(r.pending.length,6);
 assert.equal(Object.isFrozen(r.pending),true);
});
test("boolean gates cannot be satisfied by truthy strings",()=>{
 const r=assessInternalReadiness({...empty,neonNegativeTestsVerified:"true",sharedBciAuditVerified:1,hitpayReconciliationVerified:"yes"});
 assert.equal(r.internalV1Ready,false);
 assert.equal(r.pending.length,6);
});

test("synthetic caller-asserted evidence cannot authorize INTERNAL V1, even with CONTENT learning",()=>{
 const contentStages=["media_qa","approval","provider_sent","measurement","learning"];
 const contentEvidence=contentStages.map((stage,i)=>({
  tenantId,contentId:"draft-1",product:"content",stage,sourceKey:"fixture-"+stage,
  verified:true,at:`2026-10-26T0${i}:00:00Z`,
  ...(stage==="provider_sent"?{providerPostId:"synthetic-post"}:{}),
  ...(stage==="learning"?{measurementSourceKey:"fixture-measurement"}:{}),
 }));
 const demandStages=["diagnosis","decision","action","outcome","learning"];
 const demandEvidence=demandStages.map((stage,i)=>({
  tenantId,product:"demand",experimentId:"experiment-1",stage,sourceKey:"fixture-"+stage,
  verified:true,observedAt:`2026-10-26T0${i}:00:00Z`,
  ...(stage==="outcome"?{outcomeClass:"provider_verified"}:{}),
 }));
 const input={...empty,contentEvidence,demandEvidence,
  neonNegativeTestsVerified:true,sharedBciAuditVerified:true,hitpayReconciliationVerified:true};
 const candidate=assessInternalReadiness(input);
 assert.equal(candidate.contentEvidenceComplete,true);
 assert.equal(candidate.unattestedCandidateComplete,true);
 assert.equal(candidate.internalV1Ready,false);
 assert.deepEqual(candidate.pending,["authenticatedEndToEndAttestation"]);
 const noLearning=assessInternalReadiness({...input,contentEvidence:contentEvidence.slice(0,-1)});
 assert.equal(noLearning.contentEvidenceComplete,false);
 assert.equal(noLearning.unattestedCandidateComplete,false);
 assert.equal(noLearning.internalV1Ready,false);
});
