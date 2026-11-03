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
test('ordinary hook binds script, resource mapping, ordered media, copy and destination without authority',()=>{
  const x=run();assert.equal(x.proofEnvelopeId,run().proofEnvelopeId);
  assert.equal(x.schemaVersion,2);
  assert.equal(x.orderedMediaDigests.length,2);
  assert.equal(x.shotMediaBindings.length,2);
  assert.deepEqual(x.shotMediaBindings.map(x=>x.mediaSlot),[1,2]);
  assert.deepEqual(x.shotMediaBindings.map(x=>x.shot),script().shots);
  assert.equal(x.requiredHumanChecks.length,6);
  assert.deepEqual(x.automatedReviewFlags,[]);
  assert.equal(x.automatedFlagsAdjudicated,false);
  assert.equal(new Set(x.orderedMediaDigests.map(i=>i.sourceSha256)).size,2);
  assert.equal(x.resourceMapping.hookPromise,x.script.openingHook);
  assert.equal(x.destination.channelId,'ig-a');
  assert.equal(x.destination.providerOrganizationId,null);
  assert.equal(x.status,'INSTANCE_SCRIPT_AND_ORIGINAL_MEDIA_REVIEW_REQUIRED');
  assert.equal(x.trendEvidenceClaimed,false);
  assert.equal(x.bciReservationRequestCandidate,null);
  for(const k of ['humanImageReviewSigned','humanScriptReviewSigned',
    'reviewerAuthenticated','durableApprovalRecorded','providerSentVerified',
    'measurementVerified','learningVerified','executionAllowed','customerSaasReady'])
    assert.equal(x[k],false,k);
  assert.equal(Object.isFrozen(x.script.shots),true);
  assert.equal(Object.isFrozen(x.orderedMediaDigests[0]),true);
  assert.equal(Object.isFrozen(x.shotMediaBindings[0]),true);
  assert.equal(Object.isFrozen(x.automatedReviewFlags),true);
});
test('script, resource, media order, copy, channel and tenant affect immutable identity',()=>{
  const base=run().proofEnvelopeId;
  const s=script();s.sellerAction+=' Ask for confirmation.';
  assert.notEqual(run(s).proofEnvelopeId,base);
  const r=resource();r.answerLocation='The final card shows the result.';
  assert.notEqual(run(script(),r).proofEnvelopeId,base);
  assert.notEqual(run(script(),resource(),bytes().reverse()).proofEnvelopeId,base);
  const c=copy();c.caption+=' Another sentence.';
  assert.notEqual(run(script(),resource(),bytes(),c).proofEnvelopeId,base);
  const cfg=config();cfg.channels=[{service:'instagram',channelId:'ig-b'}];
  const p=brief();p.channelId='ig-b';
  assert.notEqual(run(script(),resource(),bytes(),copy(),p,cfg).proofEnvelopeId,base);
  const other=config();other.tenantId='tenant-b';
  assert.notEqual(run(script(),resource(),bytes(),copy(),brief(),other).proofEnvelopeId,base);
});
test('hook mismatch, forged trend, getter, source injection and corrupt/duplicate PNG fail closed',()=>{
  const s=script();s.openingHook='A different promise.';
  assert.throws(()=>run(s),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  assert.throws(()=>run({...script(),trendVerified:true}),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  const r=resource();r.hookPromise='Unrelated promise.';
  assert.throws(()=>run(script(),r),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  assert.throws(()=>run(script(),{...resource(),sourceUrl:'invented'}),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  const getter=script();Object.defineProperty(getter,'shots',{get(){throw Error('ACCESSOR_EXECUTED');}});
  assert.throws(()=>run(getter),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  const bad=bytes();bad[0][29]^=1;
  assert.throws(()=>run(script(),resource(),bad),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  const dup=bytes();dup[1]=dup[0];
  assert.throws(()=>run(script(),resource(),dup),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  assert.throws(()=>run({...script(),scriptId:undefined}),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  assert.throws(()=>run(script(),{...resource(),resourceId:undefined}),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  const sparse=script();sparse.shots=new Array(2);sparse.shots[1]='Only one real shot.';
  sparse.shots.extra='Filler';
  assert.throws(()=>run(sparse),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
});

test('script shots must cover every ordered image and inherited editorial holds survive',()=>{
  const s=script();s.shots=['Only the first card is described.'];
  assert.throws(()=>run(s),/CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
  const cfg=config();cfg.brand.blockedClaims=['two-step comparison'];
  const held=run(script(),resource(),bytes(),copy(),brief(),cfg);
  assert.equal(held.status,'INSTANCE_SCRIPT_AND_ORIGINAL_MEDIA_REVIEW_REQUIRED');
  assert.ok(held.automatedReviewFlags.includes('BLOCKED_CLAIM_TEXT_MATCH'));
  assert.equal(held.executionAllowed,false);
  assert.equal(held.automatedFlagsAdjudicated,false);
  assert.notEqual(held.proofEnvelopeId,run().proofEnvelopeId);
});


test('universal V3 script accepts non-selling educational and community content without SELL fields',()=>{
  const generic={scriptId:'script-education-a',revisionId:'rev-a',
    openingHook:brief().hook,
    situation:'A community group compares two available options.',
    audienceQuestion:'Which option matches the stated goal?',
    explanation:'Explain the relevant features and limitations.',
    audienceAction:'Compare each option using the same criteria.',
    takeaway:'Record the chosen option and the reason.',
    shots:['Illustrate the situation and available options.',
      'Illustrate the comparison and a practical takeaway.']};
  const v3=run(generic);
  assert.equal(v3.schemaVersion,3);
  assert.equal(v3.script.situation,generic.situation);
  assert.equal(v3.script.audienceAction,generic.audienceAction);
  assert.equal(Object.hasOwn(v3.script,'sellerAction'),false);
  assert.equal(v3.status,'INSTANCE_SCRIPT_AND_ORIGINAL_MEDIA_REVIEW_REQUIRED');
  assert.equal(v3.executionAllowed,false);
  assert.notEqual(v3.proofEnvelopeId,run().proofEnvelopeId);
  assert.equal(v3.proofEnvelopeId,run({...generic}).proofEnvelopeId);
  const tampered={...generic,audienceAction:'Recommend a different activity.'};
  assert.notEqual(run(tampered).proofEnvelopeId,v3.proofEnvelopeId);
  assert.throws(()=>run({...generic,sellerSituation:'Injected legacy field'}),
    /CONTENT_INSTANCE_SCRIPT_PROOF_DENIED/);
});
