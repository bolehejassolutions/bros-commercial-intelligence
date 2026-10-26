import test from "node:test";
import assert from "node:assert/strict";
import {normalizeEvidenceEnvelope} from "../lib/bci/evidence-envelope.ts";
const base={tenantId:"11111111-1111-4111-8111-111111111111",product:"content",provider:"fixture",
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
