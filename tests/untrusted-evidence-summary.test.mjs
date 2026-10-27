import test from "node:test";
import assert from "node:assert/strict";
import { summarizeUntrustedEvidence } from "../lib/bci/untrusted-evidence-summary.ts";
const base={tenantId:"11111111-1111-4111-8111-111111111111",product:"content",provider:"manual",providerRecordKey:"x",observedAt:"2026-10-26T00:00:00Z",environment:"test",provenance:"provider_reported",metrics:{views:0}};
test("reported evidence never counts as verified",()=>{
 assert.deepEqual(summarizeUntrustedEvidence([base]),{accepted:1,synthetic:0,providerReported:1,providerVerified:0,readyForAttestation:false});
});
test("reject duplicates and forged verification",()=>{
 assert.throws(()=>summarizeUntrustedEvidence([base,base]),/Duplicate/);
 assert.throws(()=>summarizeUntrustedEvidence([{...base,provenance:"provider_verified"}]),/Untrusted evidence/);
});

test("compound provider identities cannot collide through delimiters",()=>{
 const first={...base,provider:"ga4",providerRecordKey:"a:b"};
 const second={...base,provider:"meta_ads",providerRecordKey:"a:b"};
 assert.equal(summarizeUntrustedEvidence([first,second]).accepted,2);
 assert.throws(()=>summarizeUntrustedEvidence([{...base,provider:"a:b"}]),/Invalid evidence envelope/);
});
