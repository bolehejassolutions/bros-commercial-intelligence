import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {prepareContentIndependentImageIntents as prepare} from '../lib/content/generation-intent.mjs';
import {inspectContentGenerationSourceCandidates as inspect} from '../lib/content/generation-source-candidate.mjs';

const config=()=>({schemaVersion:1,product:'content',tenantId:'tenant-A',instanceId:'pilot-A',
  brand:{displayName:'Independent Florist',voice:'Helpful and precise',locale:'ms-MY',
    claimCandidates:[],blockedClaims:['Guaranteed revenue']},
  audience:{segment:'Local gift buyers',needs:['Clear delivery options']},
  goals:['Explain ordering steps'],channels:[{service:'instagram',channelId:'ig-A'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,requiresEvidenceForClaims:true}});
const brief=()=>({briefId:'brief-1',revisionId:'rev-1',channelService:'instagram',
  channelId:'ig-A',format:'carousel',assetCount:2,topic:'Flower ordering steps',
  hypothesis:'Clear steps could reduce confusion',hook:'How to order flowers?',
  measurementQuestion:'Do saves increase at comparable post age?'});
const slots=()=>[
  {slot:1,visualBrief:'Show a customer choosing flowers in a shop.',
    visualDistinction:'Opening scene: choosing the bouquet.',avoid:'Avoid unsupported claims.'},
  {slot:2,visualBrief:'Show the florist explaining delivery options.',
    visualDistinction:'Second scene: explaining delivery options.',avoid:'Avoid unsupported claims.'}
];
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(b){let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function chunk(type,bytes){const len=Buffer.alloc(4),sum=Buffer.alloc(4);
  len.writeUInt32BE(bytes.length);const body=Buffer.concat([Buffer.from(type),bytes]);
  sum.writeUInt32BE(crc(body));return Buffer.concat([len,body,sum]);}
function png(pixel){const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);
  header[8]=8;header[9]=2;const rows=Buffer.alloc(14,pixel);rows[0]=0;rows[7]=0;
  return Buffer.concat([sig,chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
const bytes=()=>[png(20),png(30)];
const receipts=()=>{
  const intents=prepare(config(),brief(),slots());
  return intents.jobs.map((j,i)=>({slot:i+1,generationIntentId:j.generationIntentId,
    provider:'example_provider',operationId:'operation-'+(i+1),receiptId:'receipt-'+(i+1),
    claimedGeneratedAt:'2026-10-28T10:00:00.000Z'}));
};
const opts={expectedWidth:2,expectedHeight:2};

test('binds independent intent slots to actual decoded distinct PNG bytes but NEVER verifies generation',()=>{
  const a=inspect(config(),brief(),slots(),receipts(),bytes(),opts);
  const b=inspect(config(),brief(),slots(),receipts(),bytes(),opts);
  assert.equal(a.candidateId,b.candidateId);
  assert.equal(a.images.length,2);
  assert.notEqual(a.images[0].sourceSha256,a.images[1].sourceSha256);
  assert.equal(a.sourceBytesStructurallyVerified,true);
  assert.equal(a.distinctRenderedPixelsVerified,true);
  assert.equal(a.status,'UNATTESTED_GENERATION_RECEIPTS_WITH_SOURCE_PNG_QA');
  for(const k of ['providerReceiptAuthenticated','providerCapabilityVerified',
    'independentGenerationVerified','visualEditorialQaVerified','approvalAuthenticated',
    'approvalGranted','providerSentVerified','measurementVerified','learningVerified',
    'sharedBciAuditVerified','executionAllowed','customerSaasReady'])
    assert.equal(a[k],false,k);
  assert.equal(Object.hasOwn(a,'sourceBuffers'),false);
  assert.equal(JSON.stringify(a).includes('operation-1'),false);
});
test('replay identity changes on receipt or media bytes; plan revision mismatch rejected',()=>{
  const original=inspect(config(),brief(),slots(),receipts(),bytes(),opts);
  const changed=receipts();changed[0].receiptId='receipt-changed';
  assert.notEqual(original.candidateId,inspect(config(),brief(),slots(),changed,bytes(),opts).candidateId);
  assert.notEqual(original.candidateId,inspect(config(),brief(),slots(),receipts(),[png(21),png(30)],opts).candidateId);
  const revised=brief();revised.revisionId='rev-2';
  assert.throws(()=>inspect(config(),revised,slots(),receipts(),bytes(),opts),/CONTENT_GENERATION_INTENT_RECEIPT_MISMATCH/);
});
test('rejects duplicated operation IDs and receipt IDs even with distinct pixels',()=>{
  const a=receipts();a[1].operationId=a[0].operationId;
  assert.throws(()=>inspect(config(),brief(),slots(),a,bytes(),opts),/CONTENT_REUSED_GENERATION_OPERATION_OR_RECEIPT/);
  const b=receipts();b[1].receiptId=b[0].receiptId;
  assert.throws(()=>inspect(config(),brief(),slots(),b,bytes(),opts),/CONTENT_REUSED_GENERATION_OPERATION_OR_RECEIPT/);
});
test('rejects forged success, hidden/getter claims, sparse arrays, wrong slots and invalid timestamps',()=>{
  const a=receipts();a[0].providerGenerationVerified=true;
  assert.throws(()=>inspect(config(),brief(),slots(),a,bytes(),opts),/INVALID_CONTENT_GENERATION_RECEIPT/);
  const b=receipts();Object.defineProperty(b[0],'receiptId',{enumerable:true,get(){throw Error('GETTER_EXECUTED');}});
  assert.throws(()=>inspect(config(),brief(),slots(),b,bytes(),opts),/INVALID_CONTENT_GENERATION_RECEIPT/);
  const c=receipts();c[0].slot=2;
  assert.throws(()=>inspect(config(),brief(),slots(),c,bytes(),opts),/CONTENT_GENERATION_INTENT_RECEIPT_MISMATCH/);
  const d=receipts();d[0].claimedGeneratedAt='2026-02-30T10:00:00.000Z';
  assert.throws(()=>inspect(config(),brief(),slots(),d,bytes(),opts),/INVALID_CONTENT_GENERATION_RECEIPT_CLAIM/);
  assert.throws(()=>inspect(config(),brief(),slots(),new Array(2),bytes(),opts),/INVALID_CONTENT_GENERATION_RECEIPTS/);
});
test('rejects corrupt, duplicated or missing actual PNG bytes despite plausible receipt claims',()=>{
  const a=bytes();a[0][29]^=1;
  assert.throws(()=>inspect(config(),brief(),slots(),receipts(),a,opts),/PNG_QA_BAD_CRC/);
  const b=bytes();
  assert.throws(()=>inspect(config(),brief(),slots(),receipts(),[b[0],b[0]],opts),/PNG_QA_DUPLICATE_BYTES/);
  assert.throws(()=>inspect(config(),brief(),slots(),receipts(),[],opts),/CONTENT_MEDIA_COUNT_OR_BYTES_MISMATCH/);
});
