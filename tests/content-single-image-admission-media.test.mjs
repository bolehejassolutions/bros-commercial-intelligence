import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {planContentJobCandidate} from '../lib/content/instance-plan.mjs';
import {inspectPlannedContentPngBytes} from '../lib/content/plan-source-byte-gate.mjs';
import {prepareContentSingleImageAdmissionMedia as prepare} from '../lib/content/single-image-admission-media.mjs';

const config=()=>({
  schemaVersion:1,product:'content',tenantId:'tenant-florist',
  instanceId:'florist-internal',
  brand:{displayName:'Local Florist',voice:'Clear and helpful',locale:'ms-MY',
    claimCandidates:['Flowers available on request'],blockedClaims:['Guaranteed income']},
  audience:{segment:'Local gift buyers',needs:['Understand ordering']},
  goals:['Explain ordering'],
  channels:[{service:'instagram',channelId:'ig-florist'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,
    requiresEvidenceForClaims:true}
});
const brief=()=>({
  briefId:'brief-001',revisionId:'rev-1',channelService:'instagram',
  channelId:'ig-florist',format:'single_image',assetCount:1,
  topic:'Ordering flowers',hypothesis:'Clear steps may reduce confusion',
  hook:'How to choose a bouquet?',measurementQuestion:'Are saves recorded?'
});
const copy=()=>({
  schemaVersion:1,caption:'Langkah membuat tempahan bunga yang jelas.',
  altTexts:['Ilustrasi AI tentang langkah memilih bunga.'],
  aiDisclosure:'DECLARED_AI',claimEvidenceRefs:[]
});
const dimensions={expectedWidth:2,expectedHeight:2};
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Array.from({length:256},(_,n)=>{
  let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;
  return c>>>0;
});
function crc(bytes){
  let c=0xffffffff;
  for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);
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
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);
  header[8]=8;header[9]=2;
  const rows=Buffer.alloc(14,pixel);
  rows[0]=0;rows[7]=0;
  return Buffer.concat([sig,chunk('IHDR',header),
    chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
function manifest(c,b,bytes){
  const p=planContentJobCandidate(c,b);
  const m=inspectPlannedContentPngBytes(c,b,bytes,dimensions);
  return {
    schemaVersion:1,renderer:'content-local-card-pillow-v1',
    planId:p.planId,planIdAuthenticated:false,
    status:'LOCAL_TEMPLATE_RENDERED_EDITORIAL_PENDING',
    localMediaBytesDecoded:true,externalAiProviderGenerationVerified:false,
    providerReceiptAuthenticated:false,editorialApprovalVerified:false,
    bufferSentVerified:false,sharedBciAuditVerified:false,
    executionAllowed:false,customerSaasReady:false,
    images:m.images.map(x=>({
      slot:x.slot,filename:'content_card_'+String(x.slot).padStart(2,'0')+'.png',
      byteLength:x.byteLength,sourceSha256:x.sha256,
      decodedRgbSha256:x.decodedRgbSha256
    }))
  };
}
test('real original PNG bytes produce exactly one nonauthorizing BCI media manifest',()=>{
  const c=config(),b=brief(),bytes=[png(20)];
  const out=prepare(c,b,manifest(c,b,bytes),bytes,copy(),dimensions);
  assert.deepEqual(Object.keys(out.originalMedia),
    ['handoffId','reviewPacketId','mediaSetId','originalMediaSha256','mediaCount']);
  assert.equal(out.originalMedia.mediaCount,1);
  assert.equal(out.originalMedia.originalMediaSha256,
    createHash('sha256').update(bytes[0]).digest('hex'));
  assert.equal(out.mediaBytes.equals(bytes[0]),true);
  assert.notEqual(out.mediaBytes,bytes[0]);
  assert.equal(out.status,'SINGLE_IMAGE_ORIGINAL_BYTES_RECHECKED_NONAUTHORIZING');
  for(const key of ['signedOriginalDigestVerified','reviewerAuthenticated',
    'approvalGranted','durableApprovalRecorded','atomicReservationVerified',
    'providerSentVerified','measurementVerified','sharedBciAuditVerified',
    'executionAllowed','customerSaasReady'])assert.equal(out[key],false,key);
  assert.equal(prepare(c,b,manifest(c,b,bytes),bytes,copy(),dimensions)
    .originalMedia.mediaSetId,out.originalMedia.mediaSetId);
});
test('carousel and first-slide-only submissions are rejected without fallback',()=>{
  const c=config(),b=brief(),bytes=[png(20)];
  const m=manifest(c,b,bytes);
  const carousel={...b,format:'carousel',assetCount:2};
  for(const [inputBrief,inputBytes] of [
    [carousel,bytes],[carousel,[png(20),png(30)]],
    [b,[png(20),png(30)]],[b,[]]
  ])assert.throws(()=>prepare(c,inputBrief,m,inputBytes,copy(),dimensions),
    /CONTENT_SINGLE_IMAGE_ADMISSION_MEDIA_DENIED/);
});
test('tampered actual bytes, forged renderer hash and oversized media fail closed',()=>{
  const c=config(),b=brief(),bytes=[png(20)],m=manifest(c,b,bytes);
  const corrupt=Buffer.from(bytes[0]);corrupt[29]^=1;
  assert.throws(()=>prepare(c,b,m,[corrupt],copy(),dimensions),/ADMISSION_MEDIA_DENIED/);
  const forged={...m,images:[{...m.images[0],sourceSha256:'a'.repeat(64)}]};
  assert.throws(()=>prepare(c,b,forged,bytes,copy(),dimensions),/ADMISSION_MEDIA_DENIED/);
  assert.throws(()=>prepare(c,b,m,[Buffer.alloc(20*1024*1024+1)],copy(),dimensions),
    /ADMISSION_MEDIA_DENIED/);
});
test('caller authority claims, unresolved disclosure and bad copy cannot bypass',()=>{
  const c=config(),b=brief(),bytes=[png(20)],m=manifest(c,b,bytes);
  assert.throws(()=>prepare(c,b,{...m,providerSentVerified:true},bytes,copy(),dimensions),
    /ADMISSION_MEDIA_DENIED/);
  assert.throws(()=>prepare(c,b,m,bytes,{...copy(),aiDisclosure:'UNKNOWN'},dimensions),
    /ADMISSION_MEDIA_DENIED/);
  assert.throws(()=>prepare(c,b,m,bytes,{...copy(),approvalGranted:true},dimensions),
    /ADMISSION_MEDIA_DENIED/);
});
