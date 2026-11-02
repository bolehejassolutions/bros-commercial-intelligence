import test from 'node:test';
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
