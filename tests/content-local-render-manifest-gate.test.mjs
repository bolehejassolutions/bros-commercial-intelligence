import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {planContentJobCandidate} from '../lib/content/instance-plan.mjs';
import {bindLocalContentRenderToPlan as bind} from '../lib/content/local-render-manifest-gate.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type,bytes) {
  const raw=Buffer.concat([Buffer.from(type),bytes]);
  const size=Buffer.alloc(4),sum=Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  let c=0xffffffff;for(const b of raw)c=table[(c^b)&255]^(c>>>8);
  sum.writeUInt32BE((c^0xffffffff)>>>0);
  return Buffer.concat([size,raw,sum]);
}
function png(color) {
  const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=2;
  const pixels=Buffer.alloc(14,color);pixels[0]=0;pixels[7]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',h),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const config=()=>({schemaVersion:1,product:'content',tenantId:'tenant-internal',
  instanceId:'content-pilot',brand:{displayName:'BROS SELL',voice:'Helpful clear Malay',
    locale:'ms-MY',claimCandidates:[],blockedClaims:['Guaranteed sales']},
  audience:{segment:'Malaysian sellers',needs:['Clear buyer diagnosis']},
  goals:['Explain sales process'],channels:[{service:'instagram',channelId:'ig-internal'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,requiresEvidenceForClaims:true}});
const brief=()=>({briefId:'brief-001',revisionId:'rev-1',channelService:'instagram',
  channelId:'ig-internal',format:'carousel',assetCount:2,topic:'Diagnose buyer needs',
  hypothesis:'Clear questions may improve understanding',hook:'Start with a question',
  measurementQuestion:'Are saves recorded?'});
const buffers=()=>[png(25),png(65)];
function manifest(c=config(),b=brief(),images=buffers()) {
  return {schemaVersion:1,renderer:'content-local-card-pillow-v1',
    planId:planContentJobCandidate(c,b).planId,planIdAuthenticated:false,
    status:'LOCAL_TEMPLATE_RENDERED_EDITORIAL_PENDING',localMediaBytesDecoded:true,
    externalAiProviderGenerationVerified:false,providerReceiptAuthenticated:false,
    editorialApprovalVerified:false,bufferSentVerified:false,
    sharedBciAuditVerified:false,executionAllowed:false,customerSaasReady:false,
    images:images.map((x,i)=>({slot:i+1,filename:'content_card_0'+(i+1)+'.png',
      byteLength:x.length,sourceSha256:sha(x),decodedRgbSha256:'a'.repeat(64)}))};
}
const dims={expectedWidth:2,expectedHeight:2};
test('canonical plan and actual PNG bytes bind without publishing or generation attestation',()=>{
  const c=config(),b=brief(),bytes=buffers(),m=manifest(c,b,bytes);
  const a=bind(c,b,m,bytes,dims),replay=bind(c,b,m,bytes,dims);
  assert.equal(a.mediaSetId,replay.mediaSetId);
  assert.equal(a.status,'LOCAL_RENDER_PLAN_BOUND_REVIEW_ONLY');
  assert.equal(a.sourceBytesStructurallyVerified,true);
  assert.equal(a.distinctRenderedPixelsVerified,true);
  assert.equal(a.images.length,2);
  for(const k of ['rendererManifestAttested','localGenerationAuthenticated',
    'independentAiGenerationVerified','editorialApprovalVerified','bufferSentVerified',
    'measurementVerified','learningVerified','sharedBciAuditVerified',
    'executionAllowed','customerSaasReady'])assert.equal(a[k],false,k);
});
test('wrong tenant, plan revision and slot order are rejected',()=>{
  const c=config(),b=brief(),bytes=buffers(),m=manifest(c,b,bytes);
  const changed=config();changed.tenantId='other-tenant';
  assert.throws(()=>bind(changed,b,m,bytes,dims),/CONTENT_LOCAL_RENDER_PLAN_OR_AUTHORITY_MISMATCH/);
  const revision=brief();revision.revisionId='rev-2';
  assert.throws(()=>bind(c,revision,m,bytes,dims),/CONTENT_LOCAL_RENDER_PLAN_OR_AUTHORITY_MISMATCH/);
  assert.throws(()=>bind(c,b,m,[...bytes].reverse(),dims),/CONTENT_LOCAL_RENDER_BYTES_OR_ORDER_MISMATCH/);
});
test('altered PNG bytes, corrupt source, false length and forged approvals fail closed',()=>{
  const c=config(),b=brief(),bytes=buffers(),m=manifest(c,b,bytes);
  assert.throws(()=>bind(c,b,m,[png(26),bytes[1]],dims),/CONTENT_LOCAL_RENDER_BYTES_OR_ORDER_MISMATCH/);
  const corrupt=Buffer.from(bytes[0]);corrupt[29]^=1;
  assert.throws(()=>bind(c,b,m,[corrupt,bytes[1]],dims),/PNG_QA_BAD_CRC/);
  const bad=structuredClone(m);bad.images[0].byteLength+=1;
  assert.throws(()=>bind(c,b,bad,bytes,dims),/CONTENT_LOCAL_RENDER_BYTES_OR_ORDER_MISMATCH/);
  const forged=structuredClone(m);forged.editorialApprovalVerified=true;
  assert.throws(()=>bind(c,b,forged,bytes,dims),/CONTENT_LOCAL_RENDER_PLAN_OR_AUTHORITY_MISMATCH/);
  const extra=structuredClone(m);extra.providerSentVerified=true;
  assert.throws(()=>bind(c,b,extra,bytes,dims),/INVALID_CONTENT_LOCAL_RENDER_MANIFEST/);
});
test('sparse manifest, accessor metadata and fake renderer rejected',()=>{
  const c=config(),b=brief(),bytes=buffers(),m=manifest(c,b,bytes);
  const sparse=structuredClone(m);sparse.images=new Array(2);
  assert.throws(()=>bind(c,b,sparse,bytes,dims),/CONTENT_LOCAL_RENDER_ASSET_COUNT_MISMATCH/);
  const accessor=structuredClone(m);
  Object.defineProperty(accessor.images[0],'sourceSha256',{enumerable:true,get(){throw Error('GETTER_EXECUTED');}});
  assert.throws(()=>bind(c,b,accessor,bytes,dims),/INVALID_CONTENT_LOCAL_RENDER_IMAGE/);
  const wrong=structuredClone(m);wrong.renderer='unknown-provider';
  assert.throws(()=>bind(c,b,wrong,bytes,dims),/CONTENT_LOCAL_RENDER_PLAN_OR_AUTHORITY_MISMATCH/);
});
