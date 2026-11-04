import test from 'node:test';
import {createHash} from 'node:crypto';
function sourceOrderedMediaDigest(mediaBytes){
  const hashes=mediaBytes.map(b=>createHash('sha256').update(b).digest('hex'));
  return createHash('sha256').update('BCI_CONTENT_ORDERED_MEDIA_V3\\n')
    .update(JSON.stringify(hashes.map((sha,i)=>[i+1,sha]))).digest('hex');
}

import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {prepareContentInstanceScriptProofEnvelope as prepare} from '../lib/content/instance-editorial-script-proof.mjs';
const config=()=>({schemaVersion:1,product:'content',tenantId:'tenant-a',
  instanceId:'instance-a',brand:{displayName:'Example Studio',voice:'Helpful',
    locale:'en-US',claimCandidates:[],blockedClaims:[]},
  audience:{segment:'Independent operators',needs:['Understand the service']},
  goals:['Teach one action'],channels:[{service:'instagram',channelId:'ig-a'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,
    requiresEvidenceForClaims:true}});
const brief=()=>({briefId:'brief-a',revisionId:'rev-a',channelService:'instagram',
  channelId:'ig-a',format:'carousel',assetCount:2,topic:'Choosing an option',
  hook:'Which option fits this situation?',
  hypothesis:'An explanation may help understanding',
  measurementQuestion:'Are comparable saves available?'});
const script=()=>({scriptId:'script-a',revisionId:'rev-a',
  openingHook:brief().hook,sellerSituation:'The customer compares two options.',
  diagnosticQuestion:'Which use case matters most?',
  valueExplanation:'Explain scope and limitations of each option.',
  sellerAction:'Ask one question before recommending a choice.',
  closingLine:'Choose based on the confirmed need.',
  shots:['Show the situation and options.','Show the question and a useful action.']});
const resource=()=>({resourceId:'resource-ref-a',hookPromise:brief().hook,
  demonstratedInput:'Two hypothetical use cases.',
  demonstratedAction:'Compare scope using the reference.',
  demonstratedOutput:'An illustrative decision table.',
  answerLocation:'The second slide demonstrates the comparison.'});
const copy=()=>({schemaVersion:1,caption:'A two-step comparison with fictional examples.',
  altTexts:['Slide one illustrates two options.','Slide two shows a comparison.'],
  aiDisclosure:'DECLARED_AI',claimEvidenceRefs:[]});
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type,data){const b=Buffer.concat([Buffer.from(type),data]);
  const h=Buffer.alloc(4),t=Buffer.alloc(4);h.writeUInt32BE(data.length);
  let c=0xffffffff;for(const x of b)c=table[(c^x)&255]^(c>>>8);
  t.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([h,b,t]);}
function png(pixel){const h=Buffer.alloc(13);h.writeUInt32BE(2,0);
  h.writeUInt32BE(2,4);h[8]=8;h[9]=2;
  const rows=Buffer.alloc(14,pixel);rows[0]=0;rows[7]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',h),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
const bytes=()=>[png(20),png(30)];
const opts={expectedWidth:2,expectedHeight:2};
const run=(s=script(),r=resource(),b=bytes(),c=copy(),p=brief(),cfg=config())=>
  prepare(cfg,p,s,r,b,c,opts);

import {generateKeyPairSync,sign} from 'node:crypto';
import {CONTENT_INSTANCE_SCRIPT_REVIEW_CHECKS as CHECKS,
  prepareContentInstanceScriptReviewPayload as prepareReview,
  contentInstanceScriptReviewSigningBytes as signingBytes,
  verifyContentInstanceScriptReviewReceipt as verifyReview
} from '../lib/content/instance-script-signed-review.mjs';
const input=()=>[config(),brief(),script(),resource(),bytes(),copy(),opts];
const reviewer='11111111-1111-4111-8111-111111111111';
const now=Date.parse('2026-11-03T00:00:00.000Z');
const reviewedAt='2026-11-02T23:59:00.000Z';
const expiresAt='2026-11-03T00:59:00.000Z';
const checks=()=>CHECKS.map(check=>({check,passed:true}));
function signed(args=input()){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const payload=prepareReview(args,reviewer,checks(),'a'.repeat(32),
    reviewedAt,expiresAt,now);
  const receipt={schemaVersion:1,keyId:'test-key',payload,
    signature:sign(null,signingBytes(payload),privateKey).toString('base64url')};
  return {receipt,keys:new Map([['test-key',publicKey]])};
}
test('independent original-byte script review signature binds the complete envelope, never grants approval',()=>{
  const args=input();const {receipt,keys}=signed(args);
  const v=verifyReview(args,receipt,keys,now);
  assert.equal(v.signatureVerified,true);
  assert.equal(v.proofEnvelopeId,run().proofEnvelopeId);
  assert.equal(v.status,'INSTANCE_SCRIPT_SIGNATURE_VERIFIED_EVIDENCE_ONLY');
  assert.equal(v.bciReservationRequestCandidate,null);
  for(const k of ['reviewerAuthenticated','reviewerRoleVerified','imageReviewSigned',
    'durableApprovalRecorded','atomicReservationVerified','providerSentVerified',
    'measurementVerified','learningVerified','executionAllowed','customerSaasReady'])
    assert.equal(v[k],false,k);
  assert.equal(Object.isFrozen(v),true);
});
test('script, source bytes, copy, destination, resource and tenant tampering fail closed',()=>{
  const args=input();const {receipt,keys}=signed(args);
  const mutations=[
    x=>{x[2].sellerAction+=' Another action.';},
    x=>{x[4][0][29]^=1;},
    x=>{x[4].reverse();},
    x=>{x[5].caption+=' Changed.';},
    x=>{x[3].answerLocation='Different answer location.';},
    x=>{x[0].tenantId='other-tenant';},
    x=>{x[0].channels=[{service:'instagram',channelId:'ig-b'}];x[1].channelId='ig-b';}
  ];
  for(const change of mutations){
    const fresh=input();change(fresh);
    assert.throws(()=>verifyReview(fresh,receipt,keys,now),
      /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  }
});
test('untrusted key, modified signature, payload, missing review check and replayed scope are denied',()=>{
  const args=input();const {receipt,keys}=signed(args);
  assert.throws(()=>verifyReview(args,receipt,new Map(),now),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  assert.throws(()=>verifyReview(args,{...receipt,signature:'A'+receipt.signature.slice(1)},keys,now),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  assert.throws(()=>verifyReview(args,{...receipt,payload:{...receipt.payload,nonce:'b'.repeat(32)}},keys,now),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  const p={...receipt.payload,scriptCheckResults:checks().slice(0,2)};
  assert.throws(()=>verifyReview(args,{...receipt,payload:p},keys,now),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  const mismatch=input();mismatch[2].shots.reverse();
  assert.throws(()=>verifyReview(mismatch,receipt,keys,now),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
});
test('expired review, future clock, failed checks, forged getter and editorial hold deny signing',()=>{
  assert.throws(()=>prepareReview(input(),reviewer,checks(),'a'.repeat(32),
    reviewedAt,expiresAt,now+2*3600_000),/CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  assert.throws(()=>prepareReview(input(),reviewer,checks(),'a'.repeat(32),
    reviewedAt,expiresAt,now-10*60_000),/CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  const bad=checks();bad[0].passed=false;
  assert.throws(()=>prepareReview(input(),reviewer,bad,'a'.repeat(32),
    reviewedAt,expiresAt,now),/CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  const getter=checks();Object.defineProperty(getter[0],'passed',{get(){throw Error('INJECT');}});
  assert.throws(()=>prepareReview(input(),reviewer,getter,'a'.repeat(32),
    reviewedAt,expiresAt,now),/CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  const held=input();held[0].brand.blockedClaims=['two-step comparison'];
  assert.throws(()=>prepareReview(held,reviewer,checks(),'a'.repeat(32),
    reviewedAt,expiresAt,now),/CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
});


// The ordinary non-trend script now consumes an independently signed image
// editorial review and BCI auth preflight. TEST signatures/membership only;
// neither this proof nor an image-only BCI issuer authorizes carousel dispatch.
import {inspectPlannedContentPngBytes} from '../lib/content/plan-source-byte-gate.mjs';
import {prepareLocalContentEditorialHandoff} from '../lib/content/local-render-editorial-handoff.mjs';
import {contentSignedReviewSigningBytes} from '../lib/content/signed-editorial-decision.mjs';
import {prepareContentInstanceScriptImageAuthPreflight as combined} from
  '../lib/content/instance-script-signed-review.mjs';

function pairedReview(){
  const cfg={...config(),tenantId:'22222222-2222-4222-8222-222222222222'};
  const args=[cfg,brief(),script(),resource(),bytes(),copy(),opts];
  const qa=inspectPlannedContentPngBytes(cfg,args[1],args[4],opts);
  const manifest={schemaVersion:1,renderer:'content-local-card-pillow-v1',
    planId:qa.planId,planIdAuthenticated:false,
    status:'LOCAL_TEMPLATE_RENDERED_EDITORIAL_PENDING',
    localMediaBytesDecoded:true,externalAiProviderGenerationVerified:false,
    providerReceiptAuthenticated:false,editorialApprovalVerified:false,
    bufferSentVerified:false,sharedBciAuditVerified:false,
    executionAllowed:false,customerSaasReady:false,
    images:qa.images.map(x=>({slot:x.slot,
      filename:'content_card_'+String(x.slot).padStart(2,'0')+'.png',
      byteLength:x.byteLength,sourceSha256:x.sha256,
      decodedRgbSha256:x.decodedRgbSha256}))};
  const handoff=prepareLocalContentEditorialHandoff(cfg,args[1],manifest,
    args[4],args[5],opts);
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const keys=new Map([['test-key',publicKey]]);
  const imagePayload={schemaVersion:1,product:'content',
    tenantId:handoff.tenantId,instanceId:handoff.instanceId,
    planId:handoff.planId,mediaSetId:handoff.mediaSetId,
    approvalRequestId:handoff.approvalRequestId,
    reviewPacketId:handoff.reviewPacketId,handoffId:handoff.handoffId,
    reviewerSubject:reviewer,reviewerProvider:'neon-auth',
    reviewedAt:'2026-11-02T23:58:00.000Z',
    expiresAt:'2026-11-03T01:00:00.000Z',
    nonce:'b'.repeat(32),decision:'APPROVE',
    checkResults:handoff.requiredHumanChecks.map(check=>({check,passed:true}))};
  const signImage=p=>({schemaVersion:1,keyId:'test-key',payload:p,
    signature:sign(null,contentSignedReviewSigningBytes(p),privateKey)
      .toString('base64url')});
  const signScript=p=>({schemaVersion:1,keyId:'test-key',payload:p,
    signature:sign(null,signingBytes(p),privateKey).toString('base64url')});
  const scriptPayload=prepareReview(args,reviewer,checks(),'a'.repeat(32),
    reviewedAt,expiresAt,now);
  const deps={authenticateReviewer:async()=>({userId:reviewer,authenticated:true}),
    membershipsFor:async()=>[{principalId:reviewer,tenantId:cfg.tenantId,
      product:'content',active:true}]};
  return {args,manifest,imagePayload,scriptPayload,
    imageReceipt:signImage(imagePayload),scriptReceipt:signScript(scriptPayload),
    signImage,signScript,keys,deps};
}
const combinedCall=(x,override={})=>combined(override.args||x.args,
  override.manifest||x.manifest,override.imageReceipt||x.imageReceipt,
  override.scriptReceipt||x.scriptReceipt,override.keys||x.keys,
  override.deps||x.deps,now);

test('ordinary two-image script + distinct signed image review bind original bytes and authenticated dependency, never dispatch',async()=>{
  const x=pairedReview(),out=await combinedCall(x);
  assert.equal(out.status,'INSTANCE_SCRIPT_IMAGE_AUTH_PREFLIGHT_ONLY');
  assert.equal(out.imageAndScriptSignaturesVerified,true);
  assert.equal(out.originalOrderedMediaRecomputed,true);
  assert.equal(out.serverPrincipalAndMembershipMatched,true);
  assert.match(out.signedScriptMediaEvidenceId,/^content-instance-script-signed-/);
  assert.equal(out.bciReservationRequestCandidate,null);
  for(const key of ['reviewerRoleVerified','durableApprovalRecorded',
    'atomicReservationVerified','providerSentVerified','measurementVerified',
    'learningVerified','executionAllowed','customerSaasReady'])
    assert.equal(out[key],false,key);
  assert.equal(Object.isFrozen(out),true);
});
test('ordinary script cannot borrow an image-only review across reviewer, time, nonce, tenant or original media',async()=>{
  const x=pairedReview();
  const differentReviewer='33333333-3333-4333-8333-333333333333';
  const alteredScript=prepareReview(x.args,differentReviewer,checks(),
    'a'.repeat(32),reviewedAt,expiresAt,now);
  await assert.rejects(combinedCall(x,{scriptReceipt:x.signScript(alteredScript)}),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  await assert.rejects(combinedCall(x,{imageReceipt:x.signImage({
    ...x.imagePayload,nonce:'a'.repeat(32)})}),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  await assert.rejects(combinedCall(x,{imageReceipt:x.signImage({
    ...x.imagePayload,reviewedAt:'2026-11-03T00:00:00.000Z'})}),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  const changed=[...x.args];changed[4]=[Buffer.from(x.args[4][0]),Buffer.from(x.args[4][1])];
  changed[4][0][29]^=1;
  await assert.rejects(combinedCall(x,{args:changed}),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  const wrongTenant={...x.deps,membershipsFor:async()=>[{
    principalId:reviewer,tenantId:'33333333-3333-4333-8333-333333333333',
    product:'content',active:true}]};
  await assert.rejects(combinedCall(x,{deps:wrongTenant}),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
});


test('generic V3 proof is signed, bound to original ordered media, and remains evidence-only',()=>{
  const args=input();
  args[2]={scriptId:'script-generic',revisionId:'rev-a',
    openingHook:brief().hook,
    situation:'A learning group considers two options.',
    audienceQuestion:'Which approach meets the learning objective?',
    explanation:'Explain each approach with its limitations.',
    audienceAction:'Compare the options using one consistent criterion.',
    takeaway:'Summarize the reasoning for the selected approach.',
    shots:['Show the two approaches in context.',
      'Show the comparison and the concluding takeaway.']};
  const {receipt,keys}=signed(args);
  const proof=prepare(...args);
  assert.equal(proof.schemaVersion,3);
  const verified=verifyReview(args,receipt,keys,now);
  assert.equal(verified.proofEnvelopeId,proof.proofEnvelopeId);
  assert.equal(verified.signatureVerified,true);
  assert.equal(verified.executionAllowed,false);
  assert.equal(verified.bciReservationRequestCandidate,null);
  const altered=[...args];
  altered[2]={...args[2],audienceAction:'Change the action after signature.'};
  assert.throws(()=>verifyReview(altered,receipt,keys,now),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
});

import {admitContentInstanceScriptV3Source} from '../lib/content/instance-script-signed-review.mjs';
test('V3 source admission deeply freezes whole-script binding and rejects unauthorized grants',async()=>{
  const args=input();
  args[2]={scriptId:'script-generic',revisionId:'rev-a',openingHook:brief().hook,
    situation:'Two learning options.',audienceQuestion:'Which works?',
    explanation:'Compare both.',audienceAction:'Choose a criterion.',
    takeaway:'Summarize.',shots:['First shot.','Second shot.']};
  const preflight=async ({envelope,mediaBytes})=>({
    status:'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY',signatureVerified:true,
    reviewerAuthorized:true,proofEnvelopeId:envelope.proofEnvelopeId,
    scriptIntentId:envelope.scriptIntentId,copySha256:envelope.copySha256,
    tenantId:envelope.tenantId,mediaCount:mediaBytes.length,
    signedScriptMediaEvidenceId:'test-only',orderedMediaSha256:sourceOrderedMediaDigest(mediaBytes),
    durableApprovalRecorded:false,reservationGranted:false,
    providerSent:false,executionAllowed:false});
  const out=await admitContentInstanceScriptV3Source(args,{}, {},preflight);
  assert.equal(out.executionAllowed,false);
  assert.equal(out.atomicReservationVerified,false);
  for(const key of ['script','resourceMapping','shotMediaBindings',
    'orderedMediaDigests','copy','destination']){
    assert.equal(Object.isFrozen(out.dispatchBinding[key]),true,key);
  }
  assert.equal(Object.isFrozen(out.dispatchBinding.script.shots),true);
  assert.equal(Object.isFrozen(out.destination),true);
  assert.throws(()=>{out.dispatchBinding.script.shots[0]='tampered';},TypeError);
  assert.throws(()=>{out.dispatchBinding.copy.caption='tampered';},TypeError);
  assert.throws(()=>{out.destination.channelId='tampered';},TypeError);
  await assert.rejects(admitContentInstanceScriptV3Source(args,{}, {},
    async request=>({...await preflight(request),reservationGranted:true})),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
});

test('V3 admission rejects missing, malformed and mismatched BCI evidence identifiers',async()=>{
  const args=input();
  args[2]={scriptId:'script-generic',revisionId:'rev-a',openingHook:brief().hook,
    situation:'Two learning options.',audienceQuestion:'Which works?',
    explanation:'Compare both.',audienceAction:'Choose a criterion.',
    takeaway:'Summarize.',shots:['First shot.','Second shot.']};
  const valid=async ({envelope,mediaBytes})=>({
    status:'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY',signatureVerified:true,
    reviewerAuthorized:true,proofEnvelopeId:envelope.proofEnvelopeId,
    scriptIntentId:envelope.scriptIntentId,copySha256:envelope.copySha256,
    tenantId:envelope.tenantId,mediaCount:mediaBytes.length,
    signedScriptMediaEvidenceId:'content-instance-script-signed-test',
    orderedMediaSha256:sourceOrderedMediaDigest(mediaBytes),durableApprovalRecorded:false,
    reservationGranted:false,providerSent:false,executionAllowed:false});
  const invalid=[
    x=>{delete x.signedScriptMediaEvidenceId;},
    x=>{x.signedScriptMediaEvidenceId='';},
    x=>{x.signedScriptMediaEvidenceId='bad identifier with spaces';},
    x=>{delete x.orderedMediaSha256;},
    x=>{x.orderedMediaSha256='test-only';},
    x=>{x.orderedMediaSha256='A'.repeat(64);},
    x=>{x.orderedMediaSha256='a'.repeat(64);},
    x=>{x.proofEnvelopeId='wrong-proof';},
    x=>{x.copySha256='b'.repeat(64);},
    x=>{x.tenantId='another-tenant';},
    x=>{x.mediaCount=1;},
    x=>{x.durableApprovalRecorded=true;},
    x=>{x.reservationGranted=true;},
    x=>{x.executionAllowed=true;}
  ];
  for(const mutate of invalid){
    await assert.rejects(admitContentInstanceScriptV3Source(args,{}, {},
      async request=>{const result=await valid(request);mutate(result);return result;}),
      /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  }
});


test('V3 async preflight cannot mutate ordered source media or reuse changed transport bytes',async()=>{
  const args=input();
  args[2]={scriptId:'script-generic',revisionId:'rev-a',openingHook:brief().hook,
    situation:'Two learning options.',audienceQuestion:'Which works?',
    explanation:'Compare both.',audienceAction:'Choose a criterion.',
    takeaway:'Summarize.',shots:['First shot.','Second shot.']};
  const original=args[4].map(x=>Buffer.from(x));
  const preflight=async ({envelope,mediaBytes})=>{
    mediaBytes[0][29]^=1;
    await Promise.resolve();
    return {status:'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY',
      signatureVerified:true,reviewerAuthorized:true,
      proofEnvelopeId:envelope.proofEnvelopeId,
      scriptIntentId:envelope.scriptIntentId,copySha256:envelope.copySha256,
      tenantId:envelope.tenantId,mediaCount:mediaBytes.length,
      signedScriptMediaEvidenceId:'content-instance-script-signed-test',
      orderedMediaSha256:sourceOrderedMediaDigest(mediaBytes),durableApprovalRecorded:false,
      reservationGranted:false,providerSent:false,executionAllowed:false};
  };
  await assert.rejects(admitContentInstanceScriptV3Source(args,{}, {},preflight),
    /CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  for(let i=0;i<original.length;i++)assert.deepEqual(args[4][i],original[i]);
});

test('V3 async preflight cannot rewrite either signed receipt after source admission',async()=>{
  const args=input();
  args[2]={scriptId:'script-generic',revisionId:'rev-a',openingHook:brief().hook,
    situation:'Two learning options.',audienceQuestion:'Which works?',
    explanation:'Compare both.',audienceAction:'Choose a criterion.',
    takeaway:'Summarize.',shots:['First shot.','Second shot.']};
  const accepted=({envelope,mediaBytes})=>({
    status:'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY',signatureVerified:true,
    reviewerAuthorized:true,proofEnvelopeId:envelope.proofEnvelopeId,
    scriptIntentId:envelope.scriptIntentId,copySha256:envelope.copySha256,
    tenantId:envelope.tenantId,mediaCount:mediaBytes.length,
    signedScriptMediaEvidenceId:'content-instance-script-signed-test',
    orderedMediaSha256:sourceOrderedMediaDigest(mediaBytes),durableApprovalRecorded:false,
    reservationGranted:false,providerSent:false,executionAllowed:false});
  for(const which of ['editorial','script']){
    const editorial={schemaVersion:1,signature:'original-editorial'};
    const script={schemaVersion:1,signature:'original-script'};
    await assert.rejects(admitContentInstanceScriptV3Source(args,editorial,script,
      async request=>{
        request.receipt[which].signature='mutated-after-preflight';
        await Promise.resolve();
        return accepted(request);
      }),/CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
    assert.equal(editorial.signature,'original-editorial');
    assert.equal(script.signature,'original-script');
  }
  const valid=await admitContentInstanceScriptV3Source(args,
    {schemaVersion:1,signature:'original-editorial'},
    {schemaVersion:1,signature:'original-script'},async request=>accepted(request));
  assert.equal(valid.executionAllowed,false);
  assert.match(valid.dispatchBinding.editorialReceiptSha256,/^[a-f0-9]{64}$/);
  assert.match(valid.dispatchBinding.scriptReceiptSha256,/^[a-f0-9]{64}$/);
});

test('V3 preflight rejects asynchronous mutation of complete server-owned envelope',async()=>{
  const args=input();
  args[2]={scriptId:'script-generic',revisionId:'rev-a',openingHook:brief().hook,
    situation:'Two learning options.',audienceQuestion:'Which works?',
    explanation:'Compare both.',audienceAction:'Choose a criterion.',
    takeaway:'Summarize.',shots:['First shot.','Second shot.']};
  for(const change of [
    envelope=>{envelope.script.shots[0]='changed';},
    envelope=>{envelope.destination.channelId='changed-channel';},
    envelope=>{envelope.copy.caption='changed caption';},
    envelope=>{envelope.shotMediaBindings.reverse();}
  ]){
    await assert.rejects(admitContentInstanceScriptV3Source(args,{}, {},
      async request=>{
        change(request.envelope);
        await Promise.resolve();
        return {status:'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY',
          signatureVerified:true,reviewerAuthorized:true,
          proofEnvelopeId:request.envelope.proofEnvelopeId,
          scriptIntentId:request.envelope.scriptIntentId,
          copySha256:request.envelope.copySha256,
          tenantId:request.envelope.tenantId,mediaCount:request.mediaBytes.length,
          signedScriptMediaEvidenceId:'content-instance-script-signed-test',
          orderedMediaSha256:sourceOrderedMediaDigest(mediaBytes),durableApprovalRecorded:false,
          reservationGranted:false,providerSent:false,executionAllowed:false};
      }),/CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
  }
});


test('V3 asynchronous preflight rejects truncation and replacement of ordered original media',async()=>{
  const cases=[
    mediaBytes=>{mediaBytes.pop();},
    mediaBytes=>{mediaBytes.shift();},
    mediaBytes=>{mediaBytes.splice(0,1,Buffer.from(mediaBytes[1]));},
    mediaBytes=>{mediaBytes[0]=new Uint8Array(mediaBytes[0].length);},
    mediaBytes=>{mediaBytes[0]=null;}
  ];
  for(const mutate of cases){
    const args=input();
    args[2]={scriptId:'script-generic',revisionId:'rev-a',openingHook:brief().hook,
      situation:'Two learning options.',audienceQuestion:'Which works?',
      explanation:'Compare both.',audienceAction:'Choose a criterion.',
      takeaway:'Summarize.',shots:['First shot.','Second shot.']};
    const originals=args[4].map(x=>Buffer.from(x));
    await assert.rejects(admitContentInstanceScriptV3Source(args,{}, {},
      async request=>{
        mutate(request.mediaBytes);
        await Promise.resolve();
        return {status:'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY',
          signatureVerified:true,reviewerAuthorized:true,
          proofEnvelopeId:request.envelope.proofEnvelopeId,
          scriptIntentId:request.envelope.scriptIntentId,
          copySha256:request.envelope.copySha256,
          tenantId:request.envelope.tenantId,
          mediaCount:originals.length,
          signedScriptMediaEvidenceId:'content-instance-script-signed-test',
          orderedMediaSha256:sourceOrderedMediaDigest(mediaBytes),
          durableApprovalRecorded:false,reservationGranted:false,
          providerSent:false,executionAllowed:false};
      }),/CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED/);
    for(let i=0;i<originals.length;i++)assert.deepEqual(args[4][i],originals[i]);
  }
});


test('BCI V3 source verifier recomputes original bytes and rejects forged transport',async()=>{
  const {createContentV3ServerSourceVerifier}=await import('../lib/content/instance-script-signed-review.mjs');
  const {createHash}=await import('node:crypto');
  const args=input();
  args[2]={scriptId:'script-generic',revisionId:'rev-a',openingHook:brief().hook,
    situation:'Two learning options.',audienceQuestion:'Which works?',
    explanation:'Compare both.',audienceAction:'Choose a criterion.',
    takeaway:'Summarize.',shots:['First shot.','Second shot.']};
  const envelope=prepare(...args);
  assert.equal(envelope.schemaVersion,3);
  const hashes=args[4].map(b=>createHash('sha256').update(b).digest('hex'));
  const orderedMediaSha256=createHash('sha256').update('BCI_CONTENT_ORDERED_MEDIA_V3\\n')
    .update(JSON.stringify(hashes.map((h,i)=>[i+1,h]))).digest('hex');
  const bound={proofEnvelopeId:envelope.proofEnvelopeId,
    scriptIntentId:envelope.scriptIntentId,copySha256:envelope.copySha256,
    orderedMediaSha256};
  const verifier=createContentV3ServerSourceVerifier(args);
  const snapshot={envelope:structuredClone(envelope)};
  assert.equal(await verifier(snapshot,args[4].map(x=>Buffer.from(x)),bound),true);
  const tampered=args[4].map(x=>Buffer.from(x));tampered[0][20]^=1;
  assert.equal(await verifier(snapshot,tampered,bound),false);
  const forged={envelope:structuredClone(envelope)};
  forged.envelope.copySha256='0'.repeat(64);
  assert.equal(await verifier(forged,args[4],bound),false);
  assert.equal(await verifier(snapshot,args[4],{...bound,orderedMediaSha256:'0'.repeat(64)}),false);
});
