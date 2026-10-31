import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {inspectPlannedContentPngBytes as inspect} from "../lib/content/plan-source-byte-gate.mjs";

const config = () => ({
  schemaVersion:1,product:"content",tenantId:"tenant-florist",
  instanceId:"florist-internal",brand:{displayName:"Local Florist",
    voice:"Clear and helpful",locale:"ms-MY",
    claimCandidates:["Flowers available on request"],
    blockedClaims:["Guaranteed income"]},
  audience:{segment:"Local gift buyers",needs:["Understand ordering"]},
  goals:["Explain ordering"],channels:[{service:"instagram",channelId:"ig-florist"}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,
    requiresEvidenceForClaims:true}
});
const brief = () => ({
  briefId:"brief-001",revisionId:"rev-1",channelService:"instagram",
  channelId:"ig-florist",format:"carousel",assetCount:2,
  topic:"Ordering flowers",hypothesis:"Clear steps may reduce confusion",
  hook:"How to choose a bouquet?",measurementQuestion:"Are saves recorded?"
});
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const table=Array.from({length:256},(_,n)=>{
  let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;
  return c>>>0;
});
function crc(bytes){
  let c=0xffffffff;
  for(const b of bytes)c=table[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function chunk(type,bytes){
  const length=Buffer.alloc(4),sum=Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const body=Buffer.concat([Buffer.from(type),bytes]);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length,body,sum]);
}
function png(pixel){
  const w=2,h=2,header=Buffer.alloc(13);
  header.writeUInt32BE(w,0);header.writeUInt32BE(h,4);
  header[8]=8;header[9]=2;
  const rows=Buffer.alloc(h*(1+w*3),pixel);
  for(let y=0;y<h;y++)rows[y*(1+w*3)]=0;
  return Buffer.concat([sig,chunk("IHDR",header),
    chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}
const dimensions={expectedWidth:2,expectedHeight:2};

test("real distinct PNG byte buffers bind to non-SELL universal plan with no publishing authority",()=>{
  const result=inspect(config(),brief(),[png(20),png(30)],dimensions);
  assert.equal(result.status,"SOURCE_BYTE_QA_ONLY");
  assert.equal(result.product,"content");
  assert.equal(result.images.length,2);
  assert.equal(result.sourceBytesStructurallyVerified,true);
  assert.equal(result.distinctRenderedPixelsVerified,true);
  assert.equal(result.images[0].slot,1);
  assert.match(result.images[0].sha256,/^[a-f0-9]{64}$/);
  for(const key of ["independentGenerationVerified","visualEditorialQaVerified",
    "claimEvidenceVerified","approvalAuthenticated","providerMediaBytesVerified",
    "providerCapabilityVerified","providerSentVerified","measurementVerified",
    "sharedBciAuditVerified","executionAllowed","customerSaasReady"])
    assert.equal(result[key],false,key);
  assert.equal(Object.hasOwn(result,"sourceBuffers"),false);
});
test("idempotent replay binds plan and ordered image hashes",()=>{
  const a=inspect(config(),brief(),[png(20),png(30)],dimensions);
  const b=inspect(config(),brief(),[png(20),png(30)],dimensions);
  const reversed=inspect(config(),brief(),[png(30),png(20)],dimensions);
  assert.equal(a.mediaSetId,b.mediaSetId);
  assert.equal(a.planId,b.planId);
  assert.notEqual(a.mediaSetId,reversed.mediaSetId);
  assert.equal(a.planId,reversed.planId);
});
test("brief revision and tenant changes yield separate media identities",()=>{
  const a=inspect(config(),brief(),[png(20),png(30)],dimensions);
  const changed=brief();changed.revisionId="rev-2";
  assert.notEqual(a.mediaSetId,inspect(config(),changed,[png(20),png(30)],dimensions).mediaSetId);
  const other=config();other.tenantId="another-tenant";
  assert.notEqual(a.mediaSetId,inspect(other,brief(),[png(20),png(30)],dimensions).mediaSetId);
});
test("missing, duplicate, sparse, non-buffer or extra image slots fail closed",()=>{
  const valid=[png(20),png(30)];
  for(const bad of [[],[valid[0]],[valid[0],valid[1],png(40)],
    [valid[0],valid[0]],[valid[0],"claimed-asset-id"],new Array(2)]){
    assert.throws(()=>inspect(config(),brief(),bad,dimensions),
      /CONTENT_MEDIA_COUNT_OR_BYTES_MISMATCH|PNG_QA_DUPLICATE_BYTES/);
  }
  const extra=[...valid];extra.providerSent=true;
  assert.throws(()=>inspect(config(),brief(),extra,dimensions),/CONTENT_MEDIA_COUNT_OR_BYTES_MISMATCH/);
});
test("different encodings of same rendered pixels do not count as independent images",()=>{
  const same=p=>png(p);
  assert.throws(()=>inspect(config(),brief(),[same(20),same(20)],dimensions),
    /PNG_QA_DUPLICATE_BYTES/);
});
test("corrupt actual bytes and wrong dimensions cannot pass source QA",()=>{
  const corrupt=Buffer.from(png(20));corrupt[29]^=1;
  assert.throws(()=>inspect(config(),brief(),[corrupt,png(30)],dimensions),/PNG_QA_BAD_CRC/);
  assert.throws(()=>inspect(config(),brief(),[png(20),png(30)]),
    /PNG_QA_DIMENSION_MISMATCH/);
});
test("single-image plan still requires actual bytes",()=>{
  const b=brief();b.format="single_image";b.assetCount=1;
  const result=inspect(config(),b,[png(20)],dimensions);
  assert.equal(result.images.length,1);
  assert.equal(result.approvalAuthenticated,false);
  assert.throws(()=>inspect(config(),b,[],dimensions),/CONTENT_MEDIA_COUNT_OR_BYTES_MISMATCH/);
});
test("unreviewed dimension options and client attestation injection are rejected",()=>{
  assert.throws(()=>inspect(config(),brief(),[png(20),png(30)],
    {expectedWidth:2,expectedHeight:2,providerVerified:true}),/INVALID_CONTENT_MEDIA_QA_OPTIONS/);
  assert.throws(()=>inspect(config(),brief(),[png(20),png(30)],
    {expectedWidth:2}),/INVALID_CONTENT_MEDIA_QA_OPTIONS/);
  const options={expectedWidth:2,expectedHeight:2};
  Object.defineProperty(options,"secret",{value:true});
  assert.throws(()=>inspect(config(),brief(),[png(20),png(30)],options),
    /INVALID_CONTENT_MEDIA_QA_OPTIONS/);
  const forged=brief();forged.approvalVerified=true;
  assert.throws(()=>inspect(config(),forged,[png(20),png(30)],dimensions),
    /INVALID_CONTENT_BRIEF_FIELDS/);
});
