import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContentEvidence } from "../lib/bci/content-evidence-gate.ts";
const tenantId = "11111111-1111-4111-8111-111111111111";
const contentId = "bros-sell-internal-draft-01";
const stages = ["media_qa","approval","provider_sent","measurement"];
const rows = stages.map((stage,i) => ({
  tenantId, contentId, product: "content", stage, sourceKey: "fixture-" + stage,
  verified: true, at: `2026-10-26T0${i}:00:00Z`,
  ...(stage === "provider_sent" ? {providerPostId:"fixture-provider-post"} : {}),
}));
test("complete evidence chain requires verified QA, approval, provider SENT and measurement",()=>{
  const result=evaluateContentEvidence(tenantId,contentId,rows);
  assert.equal(result.internalV1EvidenceComplete,true);
  assert.equal(result.sent,true);
});
test("scheduled or unverified provider event never becomes SENT",()=>{
  const incomplete=rows.map(r=>r.stage==="provider_sent"?{...r,verified:false}:r);
  const result=evaluateContentEvidence(tenantId,contentId,incomplete);
  assert.equal(result.sent,false);
  assert.equal(result.measured,false);
  assert.equal(result.internalV1EvidenceComplete,false);
});
test("cross tenant/product and missing provider post id fail closed",()=>{
  for(const row of [{...rows[0],tenantId:"22222222-2222-4222-8222-222222222222"},
                    {...rows[0],product:"demand"},
                    {...rows[2],providerPostId:""}]){
    assert.throws(()=>evaluateContentEvidence(tenantId,contentId,[...rows.filter(r=>r.stage!==row.stage),row]),/Invalid CONTENT evidence/);
  }
});
test("idempotent replay accepted; conflicting replay and out-of-order evidence rejected",()=>{
  assert.equal(evaluateContentEvidence(tenantId,contentId,[...rows,rows[0]]).internalV1EvidenceComplete,true);
  assert.throws(()=>evaluateContentEvidence(tenantId,contentId,[...rows,{...rows[0],verified:false}]),/Invalid CONTENT evidence/);
  assert.throws(()=>evaluateContentEvidence(tenantId,contentId,rows.map(r=>r.stage==="approval"?{...r,at:"2026-10-25T00:00:00Z"}:r)),/Invalid CONTENT evidence/);
});
