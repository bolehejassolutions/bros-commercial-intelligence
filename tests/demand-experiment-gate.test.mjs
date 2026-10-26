import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDemandExperiment } from "../lib/bci/demand-experiment-gate.ts";
const tenantId="11111111-1111-4111-8111-111111111111", experimentId="internal-synthetic-01";
const stages=["diagnosis","decision","action","outcome","learning"];
const rows=stages.map((stage,i)=>({
  tenantId,product:"demand",experimentId,stage,sourceKey:"fixture-"+stage,
  verified:true,observedAt:`2026-10-26T0${i}:00:00Z`,
  ...(stage==="outcome"?{outcomeClass:"provider_verified"}:{}),
}));
test("synthetic verified evidence chain is structurally complete, not proof of a live experiment",()=>{
  assert.equal(evaluateDemandExperiment(tenantId,experimentId,rows).internalV1EvidenceComplete,true);
});
test("platform observation never substitutes for provider-verified outcome",()=>{
  const sample=rows.map(r=>r.stage==="outcome"?{...r,outcomeClass:"platform_observation"}:r);
  assert.equal(evaluateDemandExperiment(tenantId,experimentId,sample).outcomeVerified,false);
  assert.equal(evaluateDemandExperiment(tenantId,experimentId,sample).learningDocumented,false);
});
test("missing action or outcome does not complete the gate",()=>{
  assert.equal(evaluateDemandExperiment(tenantId,experimentId,rows.filter(r=>r.stage!=="action")).internalV1EvidenceComplete,false);
  assert.equal(evaluateDemandExperiment(tenantId,experimentId,rows.filter(r=>r.stage!=="outcome")).internalV1EvidenceComplete,false);
});
test("reject cross-tenant, cross-product, conflicting replay and out-of-order timestamps",()=>{
  for(const changed of [{...rows[0],tenantId:"22222222-2222-4222-8222-222222222222"},
                       {...rows[0],product:"content"}]){
    assert.throws(()=>evaluateDemandExperiment(tenantId,experimentId,[changed]),/Invalid DEMAND/);
  }
  assert.equal(evaluateDemandExperiment(tenantId,experimentId,[...rows,rows[0]]).internalV1EvidenceComplete,true);
  assert.throws(()=>evaluateDemandExperiment(tenantId,experimentId,[...rows,{...rows[0],verified:false}]),/Invalid DEMAND/);
  assert.throws(()=>evaluateDemandExperiment(tenantId,experimentId,rows.map(r=>r.stage==="action"?{...r,observedAt:"2026-10-25T00:00:00Z"}:r)),/Invalid DEMAND/);
});
