import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {prepareContentEditorialReviewPreflight as prepare} from '../lib/content/editorial-review-preflight.mjs';
const config=()=>({schemaVersion:1,product:'content',tenantId:'tenant-florist',instanceId:'florist-internal',
  brand:{displayName:'Local Florist',voice:'Clear and helpful',locale:'ms-MY',
    claimCandidates:['Same-day delivery'],blockedClaims:['Guaranteed income']},
  audience:{segment:'Local gift buyers',needs:['Understand ordering']},
  goals:['Explain ordering'],channels:[{service:'instagram',channelId:'ig-florist'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,requiresEvidenceForClaims:true}});
const brief=()=>({briefId:'brief-001',revisionId:'rev-1',channelService:'instagram',channelId:'ig-florist',
  format:'carousel',assetCount:2,topic:'Ordering flowers',hypothesis:'Clear steps may reduce confusion',
  hook:'How to choose a bouquet?',measurementQuestion:'Are saves recorded?'});
const copy=()=>({schemaVersion:1,caption:'Choose a bouquet in two steps.',
  altTexts:['Step one: ask about the occasion.','Step two: confirm the colours.'],
  aiDisclosure:'DECLARED_AI',claimEvidenceRefs:[]});
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]),header=Buffer.alloc(4),tail=Buffer.alloc(4);
  header.writeUInt32BE(data.length);let c=0xffffffff;for(const b of body)c=crcTable[(c^b)&255]^(c>>>8);
  tail.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([header,body,tail]);}
function png(pixel){const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
  const rows=Buffer.alloc(14,pixel);rows[0]=0;rows[7]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
const bytes=()=>[png(20),png(30)];const dims={expectedWidth:2,expectedHeight:2};
test('source-byte backed review remains pending even with zero heuristic flags',()=>{
  const r=prepare(config(),brief(),bytes(),copy(),dims);
  assert.equal(r.status,'EDITORIAL_REVIEW_PENDING');assert.deepEqual(r.automatedReviewFlags,[]);
  assert.equal(r.sourceBytesStructurallyVerified,true);assert.equal(r.distinctRenderedPixelsVerified,true);
  for(const key of ['visualEditorialQaVerified','claimEvidenceVerified','aiDisclosureVerified','reviewerAuthenticated',
    'approvalGranted','providerCapabilityVerified','providerSentVerified','measurementVerified',
    'learningVerified','sharedBciAuditVerified','executionAllowed','customerSaasReady'])assert.equal(r[key],false,key);
  assert.equal(r.requiredHumanChecks.length,6);
});
test('replay stable; copy, image order and plan revision change packet identity',()=>{
  const a=prepare(config(),brief(),bytes(),copy(),dims);
  assert.equal(prepare(config(),brief(),bytes(),copy(),dims).reviewPacketId,a.reviewPacketId);
  const revised=copy();revised.caption='Different caption.';
  assert.notEqual(prepare(config(),brief(),bytes(),revised,dims).reviewPacketId,a.reviewPacketId);
  assert.notEqual(prepare(config(),brief(),bytes().reverse(),copy(),dims).reviewPacketId,a.reviewPacketId);
  const b=brief();b.revisionId='rev-2';
  assert.notEqual(prepare(config(),b,bytes(),copy(),dims).reviewPacketId,a.reviewPacketId);
});
test('blocked and candidate claims are flagged without pretending semantic truth',()=>{
  const c=copy();c.caption='Same-day delivery. Guaranteed income.';
  const r=prepare(config(),brief(),bytes(),c,dims);
  assert.deepEqual(r.automatedReviewFlags,['BLOCKED_CLAIM_TEXT_MATCH','CLAIM_EVIDENCE_REFERENCE_MISSING']);
  assert.deepEqual(r.blockedClaimTextMatches,['Guaranteed income']);
  assert.deepEqual(r.claimCandidateTextMatches,['Same-day delivery']);
  const cited=copy();cited.caption='Same-day delivery.';cited.claimEvidenceRefs=['source-123'];
  const q=prepare(config(),brief(),bytes(),cited,dims);
  assert.deepEqual(q.automatedReviewFlags,['CLAIM_EVIDENCE_REFERENCES_UNVERIFIED']);
  assert.equal(q.claimEvidenceVerified,false);
});
test('unknown AI declaration and duplicate alt text require review',()=>{
  const c=copy();c.aiDisclosure='UNKNOWN';c.altTexts=['The same slide.','THE SAME SLIDE.'];
  const r=prepare(config(),brief(),bytes(),c,dims);
  assert.deepEqual(r.automatedReviewFlags,['AI_DISCLOSURE_UNRESOLVED','DUPLICATE_ALT_TEXT_REVIEW']);
});
test('contradictory non-AI provenance is held at editorial review before signed approval',()=>{
  const c=copy();c.aiDisclosure='DECLARED_NON_AI';
  c.caption='Penerangan produk. Ilustrasi AI.';
  const flagged=prepare(config(),brief(),bytes(),c,dims);
  assert.deepEqual(flagged.automatedReviewFlags,['AI_PROVENANCE_CAPTION_CONTRADICTION']);
  assert.equal(flagged.status,'EDITORIAL_REVIEW_PENDING');
  assert.equal(flagged.approvalGranted,false);
  assert.equal(flagged.executionAllowed,false);
  const clear={...c,caption:'Penerangan produk menggunakan lakaran manual.'};
  const accepted=prepare(config(),brief(),bytes(),clear,dims);
  assert.deepEqual(accepted.automatedReviewFlags,[]);
  assert.notEqual(flagged.reviewPacketId,accepted.reviewPacketId);
});
test('invalid or duplicated bytes and forged approval fields cannot produce a review packet',()=>{
  const b=bytes();b[0][29]^=1;
  assert.throws(()=>prepare(config(),brief(),b,copy(),dims),/PNG_QA_BAD_CRC/);
  const same=png(20);assert.throws(()=>prepare(config(),brief(),[same,same],copy(),dims),/PNG_QA_DUPLICATE_BYTES/);
  const c=copy();c.approvalGranted=true;
  assert.throws(()=>prepare(config(),brief(),bytes(),c,dims),/INVALID_CONTENT_REVIEW_COPY_FIELDS/);
});
