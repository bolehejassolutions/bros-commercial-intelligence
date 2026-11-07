import test from "node:test";
import assert from "node:assert/strict";
import {demandReviewProposal, parseDemandProposalResponse}
  from "../lib/bci/neon-demand-proposal-client.ts";

const valid = {caseId:"a474cd88-76a3-4c96-8cde-4fcfea45be83",
 proposalId:"11111111-1111-4111-8111-111111111111",status:"inserted",
 reviewOnly:true,executionAuthorized:false,providerAttested:false,outcomeRecorded:false};

test("DEMAND real-case proposal uses only the four approved product-owned keys",()=>{
 assert.deepEqual(Object.keys(demandReviewProposal),
  ["hypothesis","proposedAction","proposedSuccessMetric","confidence"]);
 assert.equal(demandReviewProposal.confidence,"low");
 assert.match(demandReviewProposal.proposedAction,/without changing live ads/);
 assert.match(demandReviewProposal.proposedSuccessMetric,/currently unknown/);
 assert.equal(Object.hasOwn(demandReviewProposal,"caseId"),false);
 assert.equal(Object.hasOwn(demandReviewProposal,"tenantId"),false);
 assert.equal(Object.hasOwn(demandReviewProposal,"status"),false);
});

test("only strict signed proposal POST response is shown as inserted/replayed",()=>{
 assert.deepEqual(parseDemandProposalResponse(valid),
  {status:"inserted",proposalId:valid.proposalId});
 assert.equal(parseDemandProposalResponse({...valid,status:"replayed"}).status,"replayed");
 for(const bad of [
  {...valid,status:"APPROVED"},{...valid,executionAuthorized:true},
  {...valid,outcomeRecorded:true},{...valid,providerAttested:true},
  {...valid,reviewOnly:false},{...valid,proposalId:"not-a-uuid"},
  {...valid,caseId:"55555555-5555-4555-8555-555555555555"},
  {...valid,tenantId:"attacker"},{...valid,proposalId:null},
  null,[],{},
 ]) assert.throws(()=>parseDemandProposalResponse(bad),/Invalid proposal result/);
});
