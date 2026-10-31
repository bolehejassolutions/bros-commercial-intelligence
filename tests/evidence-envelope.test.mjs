import test from "node:test";
import assert from "node:assert/strict";
import {normalizeEvidenceEnvelope} from "../lib/bci/evidence-envelope.ts";
const base={tenantId:"11111111-1111-4111-8111-111111111111",product:"content",provider:"manual",
 providerRecordKey:"synthetic-01",observedAt:"2026-10-26T00:00:00Z",
 environment:"test",provenance:"synthetic",metrics:{impressions:null,clicks:0}};
test("preserve null versus zero and freeze normalized evidence",()=>{
 const v=normalizeEvidenceEnvelope(base);
 assert.equal(v.metrics.impressions,null);
 assert.equal(v.metrics.clicks,0);
 assert.equal(Object.isFrozen(v.metrics),true);
});
test("synthetic fixtures cannot masquerade as live provider records",()=>{
 assert.throws(()=>normalizeEvidenceEnvelope({...base,environment:"live"}),/Invalid evidence envelope/);
});
test("reject cross-schema product and non-finite metrics",()=>{
 assert.throws(()=>normalizeEvidenceEnvelope({...base,product:"sell"}),/Invalid evidence envelope/);
 assert.throws(()=>normalizeEvidenceEnvelope({...base,metrics:{clicks:Infinity}}),/Invalid evidence envelope/);
});

test("accept only existing Neon evidence provider values",()=>{
 for(const provider of ["meta_ads","ga4","buffer","manual","other"]){
  assert.equal(normalizeEvidenceEnvelope({...base,provider}).provider,provider);
 }
 for(const provider of ["fixture","future_provider","Meta_ads","", " manual "]){
  assert.throws(()=>normalizeEvidenceEnvelope({...base,provider}),/Invalid evidence envelope/);
 }
});
test("enforce existing Neon provider_record_key upper bound before persistence",()=>{
 assert.equal(normalizeEvidenceEnvelope({...base,providerRecordKey:"k".repeat(250)}).providerRecordKey.length,250);
 for(const length of [251,256,257]){
  assert.throws(()=>normalizeEvidenceEnvelope({...base,providerRecordKey:"k".repeat(length)}),/Invalid evidence envelope/);
 }
 assert.throws(()=>normalizeEvidenceEnvelope({...base,providerRecordKey:"   "}),/Invalid evidence envelope/);
});
