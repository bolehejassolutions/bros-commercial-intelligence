import test from "node:test";
import assert from "node:assert/strict";
import { assessInternalReadiness } from "../lib/bci/internal-readiness.ts";
const tenantId="11111111-1111-4111-8111-111111111111";
const empty={tenantId,contentId:"draft-1",contentEvidence:[],experimentId:"experiment-1",demandEvidence:[]};
test("internal v1 never passes with empty evidence or omitted security gates",()=>{
 const r=assessInternalReadiness(empty);
 assert.equal(r.internalV1Ready,false);
 assert.equal(r.pending.length,5);
 assert.equal(Object.isFrozen(r.pending),true);
});
test("boolean gates cannot be satisfied by truthy strings",()=>{
 const r=assessInternalReadiness({...empty,neonNegativeTestsVerified:"true",sharedBciAuditVerified:1,hitpayReconciliationVerified:"yes"});
 assert.equal(r.internalV1Ready,false);
 assert.equal(r.pending.length,5);
});
