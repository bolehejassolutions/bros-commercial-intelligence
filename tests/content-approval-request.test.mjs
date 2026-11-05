import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {prepareContentApprovalRequest as prepare} from "../lib/content/approval-request.mjs";

// Tiny offline PNGs are synthetic QA fixtures, NOT production creative or publisher proof.
const config=()=>({schemaVersion:1,product:"content",tenantId:"tenant-florist",
  instanceId:"florist-internal",brand:{displayName:"Local Florist",
    voice:"Clear and helpful",locale:"ms-MY",
    claimCandidates:["Flowers available on request"],blockedClaims:["Guaranteed income"]},
  audience:{segment:"Local gift buyers",needs:["Understand ordering"]},
  goals:["Explain ordering"],channels:[{service:"instagram",channelId:"ig-florist"}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,requiresEvidenceForClaims:true}});
const brief=()=>({briefId:"brief-001",revisionId:"rev-1",
  channelService:"instagram",channelId:"ig-florist",format:"carousel",assetCount:2,
  topic:"Ordering flowers",hypothesis:"Clear steps may reduce confusion",
  hook:"How to choose a bouquet?",measurementQuestion:"Are saves recorded?"});
const creative=()=>({schemaVersion:1,caption:"Choose a bouquet in two steps.",
  altTexts:["Step one: ask about the occasion.","Step two: confirm the preferred colours."],
  aiDisclosure:"DECLARED_AI",claimEvidenceRefs:[]});
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type,data){
  const body=Buffer.concat([Buffer.from(type),data]),header=Buffer.alloc(4),tail=Buffer.alloc(4);
  header.writeUInt32BE(data.length);let c=0xffffffff;
  for(const b of body)c=crcTable[(c^b)&255]^(c>>>8);
  tail.writeUInt32BE((c^0xffffffff)>>>0);
  return Buffer.concat([header,body,tail]);
}
function png(pixel){
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);
  header[8]=8;header[9]=2;
  const rows=Buffer.alloc(14,pixel);rows[0]=0;rows[7]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR",header),chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}
const bytes=()=>[png(20),png(30)];
const dims={expectedWidth:2,expectedHeight:2};

test("review request binds decoded source bytes and exact proposed copy but never grants approval",()=>{
  const r=prepare(config(),brief(),bytes(),creative(),dims);
  assert.equal(r.status,"REVIEW_REQUEST_ONLY");
  assert.match(r.approvalRequestId,/^content-review-[a-f0-9]{64}$/);
  assert.equal(r.imageDigests.length,2);
  assert.equal(r.copy.altTexts.length,2);
  assert.equal(r.sourceBytesStructurallyVerified,true);
  assert.equal(r.distinctRenderedPixelsVerified,true);
  for(const k of ["independentGenerationVerified","editorialQaVerified",
    "aiDisclosureVerified","claimEvidenceVerified","approvalAuthenticated",
    "approvalGranted","providerCapabilityVerified","providerSentVerified",
    "measurementVerified","learningVerified","sharedBciAuditVerified",
    "executionAllowed","customerSaasReady"])assert.equal(r[k],false,k);
  assert.equal(Object.hasOwn(r,"sourceBuffers"),false);
  assert.equal(Object.isFrozen(r.copy.altTexts),true);
});
test("stable replay, changed copy, alt text, disclosure, claims, media order and plan revision produce distinct IDs",()=>{
  const a=prepare(config(),brief(),bytes(),creative(),dims);
  assert.equal(prepare(config(),brief(),bytes(),creative(),dims).approvalRequestId,a.approvalRequestId);
  for(const field of ["caption","aiDisclosure"]){
    const c=creative();c[field]=field==="caption"?"Different caption.":"UNKNOWN";
    assert.notEqual(prepare(config(),brief(),bytes(),c,dims).approvalRequestId,a.approvalRequestId);
  }
  const alt=creative();alt.altTexts[1]="Different second image.";
  assert.notEqual(prepare(config(),brief(),bytes(),alt,dims).approvalRequestId,a.approvalRequestId);
  const claims=creative();claims.claimEvidenceRefs=["source-123"];
  assert.notEqual(prepare(config(),brief(),bytes(),claims,dims).approvalRequestId,a.approvalRequestId);
  assert.notEqual(prepare(config(),brief(),bytes().reverse(),creative(),dims).approvalRequestId,a.approvalRequestId);
  const revised=brief();revised.revisionId="rev-2";
  assert.notEqual(prepare(config(),revised,bytes(),creative(),dims).approvalRequestId,a.approvalRequestId);
  const other=config();other.tenantId="another-tenant";
  assert.notEqual(prepare(other,brief(),bytes(),creative(),dims).approvalRequestId,a.approvalRequestId);
});
test("forged approval, extra fields, accessor and hidden metadata cannot become review authority",()=>{
  for(const patch of [{approvalGranted:true},{providerSentVerified:true},{tenantId:"other"}])
    assert.throws(()=>prepare(config(),brief(),bytes(),{...creative(),...patch},dims),
      /INVALID_CONTENT_REVIEW_COPY_FIELDS/);
  const getter=creative();Object.defineProperty(getter,"caption",{get(){throw Error("GETTER_EXECUTED");}});
  assert.throws(()=>prepare(config(),brief(),bytes(),getter,dims),
    /INVALID_CONTENT_REVIEW_COPY_FIELDS/);
  const hidden=creative();Object.defineProperty(hidden,"hidden",{value:"secret"});
  assert.throws(()=>prepare(config(),brief(),bytes(),hidden,dims),
    /INVALID_CONTENT_REVIEW_COPY_FIELDS/);
});
test("slot count, sparse/accessor alt text, invalid disclosure and claim IDs fail closed",()=>{
  const short=creative();short.altTexts.pop();
  assert.throws(()=>prepare(config(),brief(),bytes(),short,dims),/CONTENT_ALT_TEXT_COUNT_MISMATCH/);
  const sparse=creative();sparse.altTexts=new Array(2);
  assert.throws(()=>prepare(config(),brief(),bytes(),sparse,dims),/INVALID_CONTENT_ALT_TEXTS/);
  const getter=creative();Object.defineProperty(getter.altTexts,"0",{get(){throw Error("GETTER_EXECUTED");}});
  assert.throws(()=>prepare(config(),brief(),bytes(),getter,dims),/INVALID_CONTENT_ALT_TEXTS/);
  const invalid=creative();invalid.aiDisclosure="AI_VERIFIED";
  assert.throws(()=>prepare(config(),brief(),bytes(),invalid,dims),/INVALID_CONTENT_AI_DISCLOSURE/);
  const dup=creative();dup.claimEvidenceRefs=["source-1","source-1"];
  assert.throws(()=>prepare(config(),brief(),bytes(),dup,dims),/INVALID_CONTENT_CLAIM_REFS/);
});
test("corrupted media or duplicate slides cannot create an approval request",()=>{
  const invalid=bytes();invalid[0][29]^=1;
  assert.throws(()=>prepare(config(),brief(),invalid,creative(),dims),/PNG_QA_BAD_CRC/);
  const one=png(20);
  assert.throws(()=>prepare(config(),brief(),[one,one],creative(),dims),/PNG_QA_DUPLICATE_BYTES/);
});

test("multiline provider-style caption is accepted with exact identity; unsafe controls and multiline alt fail closed",()=>{
  const c=creative();
  c.caption="Pelanggan mahu semak ukuran.\n\nTanya dahulu:\nBoleh saya hubungi semula?";
  const a=prepare(config(),brief(),bytes(),c,dims);
  assert.equal(a.copy.caption,c.caption);
  assert.equal(prepare(config(),brief(),bytes(),c,dims).approvalRequestId,a.approvalRequestId);
  const edited={...c,caption:c.caption.replace("\n\n","\n")};
  assert.notEqual(prepare(config(),brief(),bytes(),edited,dims).approvalRequestId,a.approvalRequestId);
  for(const control of ["\r","\t","\u0000","\u007f"]){
    const unsafe={...c,caption:"First paragraph"+control+"Second paragraph"};
    assert.throws(()=>prepare(config(),brief(),bytes(),unsafe,dims),/INVALID_CONTENT_CAPTION/);
  }
  const badAlt={...c,altTexts:["First\nSecond",c.altTexts[1]]};
  assert.throws(()=>prepare(config(),brief(),bytes(),badAlt,dims),/INVALID_CONTENT_ALT_TEXT/);
});
