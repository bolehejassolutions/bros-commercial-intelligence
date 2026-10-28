import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {prepareContentBufferDispatchIntent as prepare} from '../lib/content/buffer-dispatch-intent.mjs';

// Synthetic PNG fixtures only: never evidence of generated production media.
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]);
  const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);
  let c=0xffffffff;for(const b of body)c=crcTable[(c^b)&255]^(c>>>8);
  tail.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([head,body,tail]);}
function png(pixel){const head=Buffer.alloc(13);head.writeUInt32BE(2,0);head.writeUInt32BE(2,4);head[8]=8;head[9]=2;
  const rows=Buffer.alloc(14,pixel);rows[0]=0;rows[7]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),
    chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
const config=()=>({schemaVersion:1,product:'content',tenantId:'tenant-1',instanceId:'pilot-1',
  brand:{displayName:'Local Shop',voice:'Clear explanations',locale:'ms-MY',
    claimCandidates:[],blockedClaims:[]},
  audience:{segment:'New sellers',needs:['Explain value']},goals:['Improve explanation'],
  channels:[{service:'instagram',channelId:'ig-channel-1'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,requiresEvidenceForClaims:true}});
const brief=()=>({briefId:'brief-1',revisionId:'rev-1',channelService:'instagram',
  channelId:'ig-channel-1',format:'carousel',assetCount:2,topic:'Explain value',
  hypothesis:'Clear information may reduce confusion',hook:'What does the buyer need?',
  measurementQuestion:'Are saves available?'});
const copy=()=>({schemaVersion:1,caption:'Situasi rekaan.\n\nIlustrasi AI untuk pembelajaran.',
  altTexts:['First visual explains one question.','Second visual explains one response.'],
  aiDisclosure:'DECLARED_AI',claimEvidenceRefs:[]});
const images=()=>[png(20),png(30)];
const org=()=>({providerOrganizationId:'6ac9e9716a5c39ccb66e9555'});
const dims={expectedWidth:2,expectedHeight:2};
const run=(c=config(),b=brief(),i=images(),p=copy(),o=org())=>prepare(c,b,i,p,o,dims);

test('stable nonexecuting candidate binds exact plan, channel, media bytes, caption and Buffer organization',()=>{
  const a=run(),b=run();assert.equal(a.dispatchIntentId,b.dispatchIntentId);
  assert.match(a.dispatchIntentId,/^content-buffer-dispatch-[a-f0-9]{64}$/);
  assert.equal(a.status,'ATOMIC_RESERVATION_AND_APPROVAL_REQUIRED');
  assert.equal(a.assetCount,2);assert.equal(a.channelService,'instagram');
  assert.equal(Object.hasOwn(a,'caption'),false);
  for(const key of ['independentGenerationVerified','visualEditorialQaVerified',
    'providerAccountCapabilityVerified','authenticatedApprovalVerified','atomicReservationVerified',
    'providerUploadVerified','providerSentVerified','measurementVerified','sharedBciAuditVerified',
    'executionAllowed','customerSaasReady'])assert.equal(a[key],false,key);
  assert.equal(Object.isFrozen(a),true);
});

test('copy edit, media reorder, plan revision, tenant, channel, organization change identity',()=>{
  const original=run().dispatchIntentId;
  const edited=copy();edited.caption+=' Lagi.';
  assert.notEqual(run(config(),brief(),images(),edited).dispatchIntentId,original);
  assert.notEqual(run(config(),brief(),images().reverse()).dispatchIntentId,original);
  const revised=brief();revised.revisionId='rev-2';
  assert.notEqual(run(config(),revised).dispatchIntentId,original);
  const other=config();other.tenantId='tenant-2';
  assert.notEqual(run(other).dispatchIntentId,original);
  const alt=config();alt.channels[0].channelId='ig-channel-2';
  const b=brief();b.channelId='ig-channel-2';
  assert.notEqual(run(alt,b).dispatchIntentId,original);
  assert.notEqual(run(config(),brief(),images(),copy(),
    {providerOrganizationId:'6ac9e9716a5c39ccb66e9556'}).dispatchIntentId,original);
});

test('unknown disclosure holds, no inferred provider account capability',()=>{
  const x=copy();x.aiDisclosure='UNKNOWN';
  const result=run(config(),brief(),images(),x);
  assert.equal(result.status,'CAPABILITY_REVIEW_REQUIRED');
  assert.deepEqual(result.reviewFlags,['AI_PROVENANCE_UNRESOLVED']);
  assert.equal(result.executionAllowed,false);
});

test('forged approval, reserved operation and provider status cannot enter options',()=>{
  for(const k of ['approvalGranted','authenticatedApprovalVerified','providerSentVerified',
    'executionAllowed','reservationCommitted']){
    assert.throws(()=>run(config(),brief(),images(),copy(),{...org(),[k]:true}),
      /INVALID_CONTENT_BUFFER_DISPATCH_OPTIONS/);
  }
  const getter=org();Object.defineProperty(getter,'providerOrganizationId',
    {get(){throw Error('GETTER_EXECUTED');}});
  assert.throws(()=>run(config(),brief(),images(),copy(),getter),
    /INVALID_CONTENT_BUFFER_DISPATCH_OPTIONS/);
  assert.throws(()=>run(config(),brief(),images(),copy(),{providerOrganizationId:'wrong'}),
    /INVALID_CONTENT_BUFFER_ORGANIZATION_ID/);
});

test('wrong channel scope, corrupted PNG and duplicate rendered media are rejected',()=>{
  const b=brief();b.channelId='not-configured';
  assert.throws(()=>run(config(),b),/CONTENT_CHANNEL_NOT_CONFIGURED/);
  const broken=images();broken[0][29]^=1;
  assert.throws(()=>run(config(),brief(),broken),/PNG_QA_BAD_CRC/);
  assert.throws(()=>run(config(),brief(),[png(20),png(20)]),/PNG_QA_DUPLICATE_BYTES/);
});

test('caption control characters remain rejected, multiline caption is preserved in key',()=>{
  const original=run().dispatchIntentId;
  const single=copy();single.caption=single.caption.replace('\n\n','\n');
  assert.notEqual(run(config(),brief(),images(),single).dispatchIntentId,original);
  for(const control of ['\r','\t','\u0000','\u007f']){
    const x=copy();x.caption='Before'+control+'After';
    assert.throws(()=>run(config(),brief(),images(),x),/INVALID_CONTENT_CAPTION/);
  }
});
