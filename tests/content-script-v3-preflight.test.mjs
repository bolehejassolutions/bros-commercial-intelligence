import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createBciContentScriptV3Preflight} from '../lib/bci/content-script-v3-preflight.mjs';
const h=x=>createHash('sha256').update(x).digest('hex');
const tenantId='22222222-2222-4222-8222-222222222222';
const reviewer='11111111-1111-4111-8111-111111111111';
const img=[Buffer.alloc(64,11),Buffer.alloc(64,22)];
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const V1=['schemaVersion','product','tenantId','instanceId','planId','mediaSetId',
 'approvalRequestId','reviewPacketId','handoffId','reviewerSubject','reviewerProvider',
 'reviewedAt','expiresAt','nonce','decision','checkResults'];
const SCRIPT=['schemaVersion','product','proofEnvelopeId','tenantId','instanceId',
 'planId','reviewPacketId','scriptIntentId','copySha256','channelService',
 'channelId','reviewerSubject','reviewerProvider','reviewedAt','expiresAt',
 'nonce','decision','scriptCheckResults'];
const t1='2026-11-04T08:00:00.000Z',t2='2026-11-04T08:01:00.000Z',exp='2026-11-04T09:00:00.000Z';
const now=Date.parse('2026-11-04T08:02:00.000Z');
function signed(payload,fields,domain){
 const bytes=Buffer.from(domain+'\n'+JSON.stringify(fields.map(k=>payload[k])));
 return {schemaVersion:1,keyId:'human-key',payload,
  signature:sign(null,bytes,privateKey).toString('base64url')};
}
function fixture(){
 const a={schemaVersion:1,product:'content',tenantId,instanceId:'instance-1',
  planId:'plan-1',mediaSetId:'media-1',approvalRequestId:'request-1',
  reviewPacketId:'review-1',handoffId:'handoff-1',reviewerSubject:reviewer,
  reviewerProvider:'neon-auth',reviewedAt:t1,expiresAt:exp,
  nonce:'a'.repeat(32),decision:'APPROVE',
  checkResults:[{check:'HUMAN_MEDIA_QA',passed:true}]};
 const envelopeId='content-instance-script-proof-'+h('complete-source');
 const scriptIntentId='script-intent';
 const copySha256='a'.repeat(64);
 const b={schemaVersion:1,product:'content',proofEnvelopeId:envelopeId,
  tenantId,instanceId:'instance-1',planId:'plan-1',reviewPacketId:'review-1',
  scriptIntentId,copySha256,channelService:'instagram',channelId:'ig-1',
  reviewerSubject:reviewer,reviewerProvider:'neon-auth',reviewedAt:t2,
  expiresAt:exp,nonce:'b'.repeat(32),decision:'APPROVE',
  scriptCheckResults:[
   {check:'VERIFY_SCRIPT_SHOTS_MATCH_RENDERED_MEDIA_SEMANTICALLY',passed:true},
   {check:'VERIFY_RESOURCE_MAPPING_INPUT_ACTION_OUTPUT_AND_PAYOFF',passed:true},
   {check:'VERIFY_SCRIPT_COPY_CLAIMS_RIGHTS_AND_DISCLOSURE',passed:true}
  ]};
 const media=img.map((x,i)=>({slot:i+1,sourceSha256:h(x),
   decodedRgbaSha256:h('pixels'+i)}));
 const envelope={schemaVersion:3,product:'content',tenantId,
  instanceId:'instance-1',planId:'plan-1',reviewPacketId:'review-1',
  mediaSetId:'media-1',proofEnvelopeId:envelopeId,scriptIntentId,
  copySha256,script:{shots:['shot one','shot two']},
  orderedMediaDigests:media,shotMediaBindings:media.map((x,i)=>({
   shotIndex:i+1,shot:['shot one','shot two'][i],mediaSlot:x.slot,
   sourceSha256:x.sourceSha256,decodedRgbaSha256:x.decodedRgbaSha256
  })),automatedReviewFlags:[],
  destination:{channelService:'instagram',channelId:'ig-1',providerOrganizationId:null},
  executionAllowed:false,durableApprovalRecorded:false,
  humanImageReviewSigned:false,humanScriptReviewSigned:false};
 return {envelope,mediaBytes:img.map(x=>Buffer.from(x)),
  receipt:{editorial:signed(a,V1,'BROS_CONTENT_SIGNED_REVIEW_V1'),
   script:signed(b,SCRIPT,'BROS_CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_V1')}};
}
function setup(overrides={}){
 let sourceCalls=0;
 const preflight=createBciContentScriptV3Preflight({
  trustedPublicKeys:new Map([['human-key',publicKey]]),
  authenticateReviewer:async()=>({userId:reviewer,authenticated:true}),
  readReviewerAuthority:async()=>({principalId:reviewer,tenantId,
   product:'content',memberActive:true,
   reviewerAuthorized:overrides.authorized??true,revokedAt:null}),
  verifyServerSource:async(...args)=>{
   sourceCalls++;
   return overrides.source ? overrides.source(...args) : true;
  },
  now:overrides.now??(()=>now)
 });
 return {preflight,get sourceCalls(){return sourceCalls;}};
}
test('V3 original ordered media and two independent real Ed25519 reviews preflight only',async()=>{
 const s=setup(),r=await s.preflight(fixture());
 assert.equal(r.status,'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY');
 assert.equal(r.signatureVerified,true);
 assert.equal(r.reviewerAuthorized,true);
 assert.equal(r.mediaCount,2);
 assert.equal(r.durableApprovalRecorded,false);
 assert.equal(r.executionAllowed,false);
 assert.equal(s.sourceCalls,1);
});
test('tampered signed script, reviewer, copy, channel or image deny',async()=>{
 const mutations=[
  f=>{f.receipt.script.payload.copySha256='f'.repeat(64);},
  f=>{f.receipt.script.payload.reviewerSubject='33333333-3333-4333-8333-333333333333';},
  f=>{f.envelope.destination.channelId='another';},
  f=>{f.envelope.copySha256='0'.repeat(64);},
  f=>{f.mediaBytes[0][0]=99;},
  f=>{f.mediaBytes.reverse();},
  f=>{f.receipt.script.signature=f.receipt.editorial.signature;},
  f=>{f.receipt.script.payload.nonce='a'.repeat(32);}
 ];
 for(const mutate of mutations){const f=fixture(),s=setup();mutate(f);
  await assert.rejects(s.preflight(f),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 }
});
test('revoked reviewer, source refusal and image-only downgrade denied',async()=>{
 const revoked=setup({authorized:false});
 await assert.rejects(revoked.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 const source=setup({source:()=>false});
 await assert.rejects(source.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 const old=fixture();old.envelope.schemaVersion=2;
 await assert.rejects(setup().preflight(old),/BCI_CONTENT_SCRIPT_V3_DENIED/);
});
test('untrusted source callback cannot mutate original receipts/media',async()=>{
 const f=fixture(),orig=JSON.stringify(f.receipt),origHash=h(f.mediaBytes[0]);
 const s=setup({source:(snapshot,media)=>{
  snapshot.receipt.script.payload.channelId='changed';
  media[0].fill(99);
  return true;
 }});
 assert.equal((await s.preflight(f)).executionAllowed,false);
 assert.equal(JSON.stringify(f.receipt),orig);
 assert.equal(h(f.mediaBytes[0]),origHash);
});

test('V3 expires during source recomputation and never authenticates reviewer',async()=>{
 let ticks=0;
 const clock=()=>++ticks===1?now:Date.parse(exp);
 const s=setup({now:clock});
 await assert.rejects(s.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 assert.equal(s.sourceCalls,1);
});
test('V3 rejects clock rollback after source verification',async()=>{
 let ticks=0;
 const s=setup({now:()=>++ticks===1?now:now-1});
 await assert.rejects(s.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
});
test('V3 expires after reviewer authorization without issuing approval',async()=>{
 let ticks=0;
 const s=setup({now:()=>++ticks<3?now:Date.parse(exp)});
 await assert.rejects(s.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 assert.equal(s.sourceCalls,1);
});
