import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planContentJobCandidate} from '../lib/content/instance-plan.mjs';
import {bindLocalContentRenderToPlan} from '../lib/content/local-render-manifest-gate.mjs';
import {prepareLocalContentEditorialHandoff} from '../lib/content/local-render-editorial-handoff.mjs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {contentSignedReviewSigningBytes,verifyContentSignedEditorialDecision} from '../lib/content/signed-editorial-decision.mjs';
import {prepareContentReviewDispatchPreflight} from '../lib/content/review-dispatch-binding.mjs';
import {prepareContentBufferDispatchIntent} from '../lib/content/buffer-dispatch-intent.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const config={
  schemaVersion:1,product:'content',tenantId:'22222222-2222-4222-8222-222222222222',
  instanceId:'content-pilot',brand:{displayName:'BROS SELL',voice:'Clear educational Malay',
    locale:'ms-MY',claimCandidates:[],blockedClaims:['Guaranteed sales']},
  audience:{segment:'Malaysian sellers',needs:['Understand customer requirements']},
  goals:['Explain a useful selling principle'],
  channels:[{service:'instagram',channelId:'ig-internal'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,
    requiresEvidenceForClaims:true}
};
const brief={briefId:'brief-local-qa',revisionId:'rev-1',
  channelService:'instagram',channelId:'ig-internal',format:'carousel',
  assetCount:2,topic:'Diagnose customer needs',
  hypothesis:'Clear questions may improve understanding',
  hook:'Start with a question',measurementQuestion:'Are saves recorded?'};

// Generic repository CI has no Pillow dependency. Dedicated CONTENT CI installs Pillow
// before Node tests and must execute this provider-independent real-byte bridge.
const hasPillow=spawnSync('python3',['-c','from PIL import Image'],{encoding:'utf8'}).status===0;
test('real canonical plan -> Pillow 1080x1350 RGB PNG bytes -> manifest -> independent Node QA; review-only',
  {skip:hasPillow?false:'Pillow unavailable; real bridge runs in dedicated CONTENT CI'},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'content-real-render-'));
  try {
    const plan=planContentJobCandidate(config,brief);
    const input=join(dir,'payload.json'),out=join(dir,'rendered');
    mkdirSync(out);
    writeFileSync(input,JSON.stringify({planId:plan.planId,brandName:'BROS SELL',
      cards:[
        {slot:1,title:'Mulakan dengan satu soalan',
          body:'Tanya apa yang pelanggan mahu selesaikan sebelum mencadangkan produk.',accent:'gold'},
        {slot:2,title:'Semak keperluan pelanggan',
          body:'Terangkan pilihan berdasarkan maklumat produk yang sudah disahkan.',accent:'teal'}
      ]}));
    execFileSync('python3',[join(root,'scripts/content_local_card_renderer.py'),input,out],
      {timeout:60000,stdio:'pipe'});
    const manifest=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8'));
    const buffers=manifest.images.map(x=>readFileSync(join(out,x.filename)));
    const bound=bindLocalContentRenderToPlan(config,brief,manifest,buffers);
    assert.equal(bound.planId,plan.planId);
    assert.equal(bound.images.length,2);
    assert.equal(bound.sourceBytesStructurallyVerified,true);
    assert.equal(bound.distinctRenderedPixelsVerified,true);
    assert.notEqual(bound.images[0].sha256,bound.images[1].sha256);
    for(let i=0;i<2;i++){
      assert.equal(bound.images[i].width,1080);
      assert.equal(bound.images[i].height,1350);
      assert.equal(bound.images[i].decodedRgbSha256,manifest.images[i].decodedRgbSha256);
      assert.ok(buffers[i].length>10000);
    }
    const copy={schemaVersion:1,
      caption:'Tanya dahulu apa yang pelanggan perlukan.\n\nKemudian jelaskan pilihan yang sesuai.',
      altTexts:['Slide pertama menerangkan soalan pelanggan.',
        'Slide kedua menerangkan semakan keperluan pelanggan.'],
      aiDisclosure:'DECLARED_NON_AI',claimEvidenceRefs:[]};
    const handoff=prepareLocalContentEditorialHandoff(config,brief,manifest,buffers,copy);
    assert.equal(handoff.status,'LOCAL_MEDIA_EDITORIAL_REVIEW_PENDING');
    // Real Pillow source bytes -> editorial handoff -> cryptographically signed
    // review evidence. Test-only key; NEVER a human auth or publish grant.
    const {privateKey,publicKey}=generateKeyPairSync('ed25519');
    const reviewedAt='2026-10-29T06:59:00.000Z',expiresAt='2026-10-29T08:00:00.000Z';
    const payload={schemaVersion:1,product:'content',tenantId:handoff.tenantId,
      instanceId:handoff.instanceId,planId:handoff.planId,mediaSetId:handoff.mediaSetId,
      approvalRequestId:handoff.approvalRequestId,reviewPacketId:handoff.reviewPacketId,
      handoffId:handoff.handoffId,reviewerSubject:'test-reviewer',reviewerProvider:'test',
      reviewedAt,expiresAt,nonce:'c'.repeat(32),decision:'APPROVE',
      checkResults:handoff.requiredHumanChecks.map(check=>({check,passed:true}))};
    const receipt={schemaVersion:1,keyId:'test-only',payload,
      signature:sign(null,contentSignedReviewSigningBytes(payload),privateKey).toString('base64url')};
    const signed=verifyContentSignedEditorialDecision(handoff,receipt,
      new Map([['test-only',publicKey]]),Date.parse('2026-10-29T07:00:00.000Z'));
    // Real Pillow media -> freshly recomputed handoff -> test-signed Neon-shaped
    // reviewer/membership -> exact Buffer dispatch candidate. No actual provider
    // authentication, human approval, reservation, publish or SENT occurs.
    const reviewer='11111111-1111-4111-8111-111111111111';
    const scopedPayload={...payload,reviewerSubject:reviewer,reviewerProvider:'neon-auth',
      nonce:'d'.repeat(32)};
    const scopedReceipt={schemaVersion:1,keyId:'test-only',payload:scopedPayload,
      signature:sign(null,contentSignedReviewSigningBytes(scopedPayload),privateKey).toString('base64url')};
    const authDeps={authenticateReviewer:async()=>({userId:reviewer,authenticated:true}),
      membershipsFor:async(id,product)=>[{
        principalId:id,tenantId:config.tenantId,product,active:true}]};
    const dispatchOptions={providerOrganizationId:'5c8ff5094c54ee487265a5c6'};
    const bindingArgs=[config,brief,manifest,buffers,copy,dispatchOptions,
      scopedReceipt,new Map([['test-only',publicKey]]),authDeps,
      Date.parse('2026-10-29T07:00:00.000Z')];
    const candidate=await prepareContentReviewDispatchPreflight(...bindingArgs);
    assert.equal(candidate.status,'SIGNED_REVIEW_DISPATCH_SCOPE_BOUND_PREFLIGHT_ONLY');
    assert.equal(candidate.approvalRequestId,handoff.approvalRequestId);
    assert.equal(candidate.mediaSetId,bound.mediaSetId);
    assert.match(candidate.dispatchIntentId,/^content-buffer-dispatch-[a-f0-9]{64}$/);
    // Cross-branch BCI private contract shape; no database adapter, approval
    // persistence or provider action is supplied by this CONTENT mapping.
    const bciRequest=candidate.bciReservationRequestCandidate;
    const dispatch=prepareContentBufferDispatchIntent(config,brief,buffers,copy,dispatchOptions);
    assert.deepEqual(Object.keys(bciRequest),['dispatchIntentId','binding']);
    assert.deepEqual(Object.keys(bciRequest.binding),[
      'reviewPacketId','handoffId','signedReviewEvidenceId','planId',
      'mediaSetId','copySha256','providerOrganizationId','channelId']);
    assert.deepEqual(bciRequest,{
      dispatchIntentId:dispatch.dispatchIntentId,
      binding:{
        reviewPacketId:handoff.reviewPacketId,handoffId:handoff.handoffId,
        signedReviewEvidenceId:candidate.signedReviewEvidenceId,
        planId:handoff.planId,mediaSetId:handoff.mediaSetId,
        copySha256:dispatch.copySha256,
        providerOrganizationId:dispatchOptions.providerOrganizationId,
        channelId:brief.channelId
      }
    });
    assert.equal(Object.isFrozen(bciRequest),true);
    assert.equal(Object.isFrozen(bciRequest.binding),true);
    assert.ok(Object.entries(bciRequest.binding).every(([key,value])=>
      key==='copySha256' ? /^[a-f0-9]{64}$/.test(value) :
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)));
    for(const key of ['providerOrganizationAuthenticated','reviewerAuthenticatedByThisModule',
      'visualEditorialQaVerified','approvalGranted','durableApprovalRecorded',
      'atomicReservationVerified','providerAccountCapabilityVerified',
      'providerUploadVerified','providerSentVerified','measurementVerified',
      'learningVerified','sharedBciAuditVerified','executionAllowed','customerSaasReady'])
      assert.equal(candidate[key],false,key);
    assert.equal((await prepareContentReviewDispatchPreflight(...bindingArgs)).dispatchIntentId,
      candidate.dispatchIntentId);
    const changedCaption={...copy,caption:copy.caption+' Lagi.'};
    await assert.rejects(prepareContentReviewDispatchPreflight(config,brief,manifest,buffers,
      changedCaption,dispatchOptions,scopedReceipt,new Map([['test-only',publicKey]]),
      authDeps,Date.parse('2026-10-29T07:00:00.000Z')),
      /CONTENT_REVIEW_DISPATCH_BINDING_DENIED/);
    const crossTenant={...authDeps,membershipsFor:async(id,product)=>[{
      principalId:id,tenantId:'33333333-3333-4333-8333-333333333333',
      product,active:true}]};
    await assert.rejects(prepareContentReviewDispatchPreflight(config,brief,manifest,buffers,
      copy,dispatchOptions,scopedReceipt,new Map([['test-only',publicKey]]),
      crossTenant,Date.parse('2026-10-29T07:00:00.000Z')),
      /CONTENT_REVIEW_DISPATCH_BINDING_DENIED/);
    // A valid signature and stubbed membership must not launder unresolved
    // automated editorial warnings into a dispatch candidate. The Buffer
    // capability gate alone does not see claim references or duplicate alt text.
    for(const [flaggedCopy,expectedFlag] of [
      [{...copy,claimEvidenceRefs:['source-1']},'CLAIM_EVIDENCE_REFERENCES_UNVERIFIED'],
      [{...copy,altTexts:[copy.altTexts[0],copy.altTexts[0]]},'DUPLICATE_ALT_TEXT_REVIEW']
    ]){
      const flaggedHandoff=prepareLocalContentEditorialHandoff(config,brief,manifest,
        buffers,flaggedCopy);
      assert.ok(flaggedHandoff.automatedReviewFlags.includes(expectedFlag));
      const flaggedDispatch=prepareContentBufferDispatchIntent(config,brief,buffers,
        flaggedCopy,dispatchOptions);
      assert.equal(flaggedDispatch.status,'ATOMIC_RESERVATION_AND_APPROVAL_REQUIRED');
      assert.deepEqual(flaggedDispatch.reviewFlags,[]);
      const flaggedPayload={...scopedPayload,
        approvalRequestId:flaggedHandoff.approvalRequestId,
        reviewPacketId:flaggedHandoff.reviewPacketId,
        handoffId:flaggedHandoff.handoffId,nonce:'e'.repeat(32)};
      const flaggedReceipt={schemaVersion:1,keyId:'test-only',payload:flaggedPayload,
        signature:sign(null,contentSignedReviewSigningBytes(flaggedPayload),
          privateKey).toString('base64url')};
      assert.equal(verifyContentSignedEditorialDecision(flaggedHandoff,flaggedReceipt,
        new Map([['test-only',publicKey]]),
        Date.parse('2026-10-29T07:00:00.000Z')).signatureVerified,true);
      await assert.rejects(prepareContentReviewDispatchPreflight(config,brief,manifest,
        buffers,flaggedCopy,dispatchOptions,flaggedReceipt,
        new Map([['test-only',publicKey]]),authDeps,
        Date.parse('2026-10-29T07:00:00.000Z')),
        /CONTENT_REVIEW_DISPATCH_BINDING_DENIED/);
    }
    assert.equal(signed.signatureVerified,true);
    assert.equal(signed.approvalGranted,false);
    assert.equal(signed.executionAllowed,false);
    assert.equal(signed.reviewerAuthenticated,false);
    const tampered={...receipt,payload:{...payload,mediaSetId:'content-media-'+'0'.repeat(64)}};
    assert.throws(()=>verifyContentSignedEditorialDecision(handoff,tampered,
      new Map([['test-only',publicKey]]),Date.parse('2026-10-29T07:00:00.000Z')),
      /SCOPE_MISMATCH/);
    assert.equal(handoff.mediaSetId,bound.mediaSetId);
    assert.match(handoff.approvalRequestId,/^content-review-[0-9a-f]{64}$/);
    assert.match(handoff.reviewPacketId,/^content-editorial-[0-9a-f]{64}$/);
    assert.equal(prepareLocalContentEditorialHandoff(config,brief,manifest,buffers,copy).handoffId,
      handoff.handoffId);
    const changedCopy={...copy,caption:'Berikan penjelasan baharu untuk pelanggan.'};
    assert.notEqual(prepareLocalContentEditorialHandoff(config,brief,manifest,buffers,
      changedCopy).handoffId,handoff.handoffId);
    const unsafeCopy={...copy,approvalGranted:true};
    assert.throws(()=>prepareLocalContentEditorialHandoff(config,brief,manifest,buffers,
      unsafeCopy),/INVALID_CONTENT_REVIEW_COPY_FIELDS/);
    for(const key of ['rendererManifestAttested','planAuthenticated',
      'localGenerationAuthenticated','independentAiGenerationVerified',
      'visualEditorialQaVerified','claimEvidenceVerified','aiDisclosureVerified',
      'reviewerAuthenticated','approvalGranted','atomicReservationVerified',
      'providerCapabilityVerified','providerSentVerified','measurementVerified',
      'learningVerified','sharedBciAuditVerified','executionAllowed','customerSaasReady'])
      assert.equal(handoff[key],false,key);
    const replay=bindLocalContentRenderToPlan(config,brief,manifest,buffers);
    assert.equal(bound.mediaSetId,replay.mediaSetId);
    const forged=structuredClone(manifest);
    forged.images[0].decodedRgbSha256='0'.repeat(64);
    assert.throws(()=>prepareLocalContentEditorialHandoff(config,brief,forged,buffers,copy),
      /CONTENT_LOCAL_RENDER_BYTES_OR_ORDER_MISMATCH/);
    assert.throws(()=>bindLocalContentRenderToPlan(config,brief,forged,buffers),
      /CONTENT_LOCAL_RENDER_BYTES_OR_ORDER_MISMATCH/);
    const revised={...brief,revisionId:'rev-2'};
    assert.throws(()=>bindLocalContentRenderToPlan(config,revised,manifest,buffers),
      /CONTENT_LOCAL_RENDER_PLAN_OR_AUTHORITY_MISMATCH/);
    for(const flag of ['rendererManifestAttested','localGenerationAuthenticated',
      'independentAiGenerationVerified','editorialApprovalVerified','bufferSentVerified',
      'measurementVerified','learningVerified','sharedBciAuditVerified',
      'executionAllowed','customerSaasReady']) assert.equal(bound[flag],false,flag);
    assert.equal(bound.status,'LOCAL_RENDER_PLAN_BOUND_REVIEW_ONLY');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
