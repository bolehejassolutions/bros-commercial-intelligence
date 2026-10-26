import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUntrustedEvidence } from "../lib/bci/untrusted-evidence.ts";
const base={tenantId:"11111111-1111-4111-8111-111111111111",product:"demand",provider:"fixture",providerRecordKey:"r1",observedAt:"2026-10-26T00:00:00Z",environment:"test",provenance:"provider_reported",metrics:{clicks:0}};
test("untrusted provider reports remain unverified",()=>{
 assert.equal(normalizeUntrustedEvidence(base).provenance,"provider_reported");
});
test("untrusted input cannot claim provider verification",()=>{
 assert.throws(()=>normalizeUntrustedEvidence({...base,provenance:"provider_verified"}),/Untrusted evidence/);
});
