import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createContentBciIssuerSourceCallbacks} from '../lib/content/bci-issuer-source-context.mjs';
import {prepareContentSingleImageAdmissionMedia} from '../lib/content/single-image-admission-media.mjs';
import {prepareContentBufferDispatchIntent} from '../lib/content/buffer-dispatch-intent.mjs';
import {prepareContentAdmissionV2Payload,contentAdmissionV2SigningBytes,
  verifyContentAdmissionV2} from '../lib/content/signed-admission-v2.mjs';
import {planContentJobCandidate} from '../lib/content/instance-plan.mjs';
import {prepareLocalContentEditorialHandoff} from '../lib/content/local-render-editorial-handoff.mjs';
import {contentSignedReviewSigningBytes} from '../lib/content/signed-editorial-decision.mjs';
import {reserveContentReviewedImageDispatch} from '../lib/content/review-dispatch-binding.mjs';

// Real decoded original PNG bytes and real Ed25519 math; TEST key, simulated
// reviewer/JWT/BCI service. This never proves a real human review or DB write.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hasPillow=spawnSync('python3',['-c','from PIL import Image'],{encoding:'utf8'}).status===0;
test('real single PNG and signed scope reach BCI transport; changed copy/bytes and carousel never submit',
  {skip:hasPillow?false:'Pillow unavailable; executes in dedicated CONTENT CI'},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'content-bci-byte-'));
  try{
    const tenantId='22222222-2222-4222-8222-222222222222';
    const reviewer='11111111-1111-4111-8111-111111111111';
    const config={schemaVersion:1,product:'content',tenantId,instanceId:'review-transport-test',
      brand:{displayName:'Example Studio',voice:'Clear practical education',locale:'en-US',claimCandidates:[],blockedClaims:[]},
      audience:{segment:'Independent sellers',needs:['Understand customer requirements']},
      goals:['Explain a practical question'],channels:[{service:'instagram',channelId:'ig-test'}],
      policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,requiresEvidenceForClaims:true}};
    const brief={briefId:'bci-byte-bridge',revisionId:'rev-1',channelService:'instagram',channelId:'ig-test',
      format:'single_image',assetCount:1,topic:'Understand customer needs',
      hypothesis:'Clear questions may improve understanding',hook:'Start with a question',
      measurementQuestion:'Are saves recorded?'};
    const plan=planContentJobCandidate(config,brief),out=join(dir,'media');mkdirSync(out);
    const input=join(dir,'input.json');writeFileSync(input,JSON.stringify({planId:plan.planId,
      brandName:'Example Studio',cards:[{slot:1,title:'Ask one useful question',
        body:'Understand what the customer wants to solve before describing a suitable option.',accent:'teal'}]}));
    execFileSync('python3',[join(root,'scripts/content_local_card_renderer.py'),input,out],{timeout:60000,stdio:'pipe'});
    const manifest=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8'));
    const buffers=manifest.images.map(m=>readFileSync(join(out,m.filename)));
    const copy={schemaVersion:1,caption:'Ask what the customer needs, then explain a suitable option.',
      altTexts:['An educational card describing a useful customer question.'],aiDisclosure:'DECLARED_NON_AI',claimEvidenceRefs:[]};
    const handoff=prepareLocalContentEditorialHandoff(config,brief,manifest,buffers,copy);
    assert.equal(handoff.automatedReviewFlags.length,0);
    const now=Date.parse('2026-11-02T12:00:00.000Z');
    const payload={schemaVersion:1,product:'content',tenantId,instanceId:handoff.instanceId,
      planId:handoff.planId,mediaSetId:handoff.mediaSetId,approvalRequestId:handoff.approvalRequestId,
      reviewPacketId:handoff.reviewPacketId,handoffId:handoff.handoffId,
      reviewerSubject:reviewer,reviewerProvider:'neon-auth',reviewedAt:'2026-11-02T11:59:00.000Z',
      expiresAt:'2026-11-02T13:00:00.000Z',nonce:'b'.repeat(32),decision:'APPROVE',
      checkResults:handoff.requiredHumanChecks.map(check=>({check,passed:true}))};
    const {privateKey,publicKey}=generateKeyPairSync('ed25519');
    const receipt={schemaVersion:1,keyId:'test-only',payload,
      signature:sign(null,contentSignedReviewSigningBytes(payload),privateKey).toString('base64url')};
    const auth={authenticateReviewer:async()=>({userId:reviewer,authenticated:true}),
      membershipsFor:async(id,product)=>[{principalId:id,tenantId,product,active:true}]};
    const args=[config,brief,manifest,buffers,copy,{providerOrganizationId:'a'.repeat(24)},receipt,
      new Map([['test-only',publicKey]]),auth];
    const requests=[];const transport={requestToken:async()=>'aaa.bbb.ccc',
      fetchSameOrigin:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});
        return Response.json({status:'reserved',reservationId:'33333333-3333-4333-8333-333333333333',
          postCommitReadback:true,providerSent:false,executionAllowed:false},
          {headers:{'Cache-Control':'private, no-store',Vary:'Authorization'}});}};
    const result=await reserveContentReviewedImageDispatch(args,'test-durable-approval',transport,now);
    assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/internal/neon-content-reservation');
    assert.match(requests[0].body.dispatchIntentId,/^content-buffer-dispatch-[a-f0-9]{64}$/);
    assert.equal(result.executionAllowed,false);assert.equal(result.approvalGranted,false);
    assert.equal(result.providerSentVerified,false);
    const changedCopy=[...args];changedCopy[4]={...copy,caption:copy.caption+' Updated.'};
    await assert.rejects(reserveContentReviewedImageDispatch(changedCopy,'test-durable-approval',transport,now));
    const corrupt=[...args],bad=Buffer.from(buffers[0]);bad[50]^=1;corrupt[3]=[bad];
    await assert.rejects(reserveContentReviewedImageDispatch(corrupt,'test-durable-approval',transport,now));
    const carousel=[...args];carousel[3]=[buffers[0],buffers[0]];
    await assert.rejects(reserveContentReviewedImageDispatch(carousel,'test-durable-approval',transport,now));
    assert.equal(requests.length,1);

    // The BCI trusted issuer requires CONTENT-owned callbacks that recompute
    // original media and signed destination/copy context, not caller digests.
    // This remains an OFFLINE test with TEST keys and simulated provider auth.
    const keys=new Map([['test-only',publicKey]]);
    const original=prepareContentSingleImageAdmissionMedia(config,brief,manifest,buffers,copy);
    const dispatch=prepareContentBufferDispatchIntent(config,brief,buffers,copy,
      {providerOrganizationId:'a'.repeat(24)});
    const media={originalMedia:original.originalMedia,mediaBytes:original.mediaBytes};
    const v2Payload=prepareContentAdmissionV2Payload(handoff,receipt,media,dispatch,
      keys,'c'.repeat(32),now);
    const v2Receipt={schemaVersion:2,keyId:'test-only',payload:v2Payload,
      signature:sign(null,contentAdmissionV2SigningBytes(v2Payload),privateKey)
        .toString('base64url')};
    const v2=verifyContentAdmissionV2(handoff,receipt,media,dispatch,v2Receipt,keys,now);
    const sourceContext={reviewScope:'IMAGE_ONLY_NO_SCRIPT',instanceConfig:config,
      brief,rendererManifest:manifest,proposedCopy:copy,
      dispatchOptions:{providerOrganizationId:'a'.repeat(24)},
      trustedPublicKeys:keys,now:()=>now};
    const callbacks=createContentBciIssuerSourceCallbacks(sourceContext);
    const pinned={dispatchIntentId:dispatch.dispatchIntentId,binding:v2.binding,
      receipt:{editorial:receipt,admission:v2Receipt}};
    const admitted={tenantId,dispatchIntentId:dispatch.dispatchIntentId,
      reviewerId:reviewer,signedReviewEvidenceId:v2.verified.signedReviewEvidenceId,
      originalMediaSha256:original.originalMedia.originalMediaSha256,mediaCount:1,
      bindingSha256:v2.bindingSha256,
      dispatchIntentSha256:v2.verified.signedDispatchIntentSha256};
    assert.deepEqual(await callbacks.recomputeOriginalMedia(buffers[0]),
      original.originalMedia);
    assert.equal(await callbacks.verifyContentSourceContext(pinned,buffers[0],admitted),true);
    await assert.rejects(callbacks.verifyContentSourceContext(
      {...pinned,dispatchIntentId:'other-intent'},buffers[0],admitted),
      /CONTENT_BCI_ISSUER_SOURCE_CONTEXT_DENIED/);
    await assert.rejects(callbacks.verifyContentSourceContext(pinned,buffers[0],
      {...admitted,bindingSha256:'0'.repeat(64)}),
      /CONTENT_BCI_ISSUER_SOURCE_CONTEXT_DENIED/);
    await assert.rejects(callbacks.verifyContentSourceContext(pinned,bad,admitted),
      /CONTENT_BCI_ISSUER_SOURCE_CONTEXT_DENIED/);
    await assert.rejects(callbacks.verifyContentSourceContext({...pinned,
      receipt:{...pinned.receipt,admission:{...v2Receipt,signature:'A'.repeat(86)}}},
      buffers[0],admitted),/CONTENT_BCI_ISSUER_SOURCE_CONTEXT_DENIED/);
    const changedCopyContext=createContentBciIssuerSourceCallbacks({
      ...sourceContext,proposedCopy:{...copy,caption:copy.caption+' Revised.'}});
    await assert.rejects(changedCopyContext.verifyContentSourceContext(
      pinned,buffers[0],admitted),/CONTENT_BCI_ISSUER_SOURCE_CONTEXT_DENIED/);
    const changedDestination=createContentBciIssuerSourceCallbacks({
      ...sourceContext,dispatchOptions:{providerOrganizationId:'b'.repeat(24)}});
    await assert.rejects(changedDestination.verifyContentSourceContext(
      pinned,buffers[0],admitted),/CONTENT_BCI_ISSUER_SOURCE_CONTEXT_DENIED/);
    assert.throws(()=>createContentBciIssuerSourceCallbacks({
      ...sourceContext,reviewScope:'SCRIPT_OR_CAROUSEL'}),
      /CONTENT_BCI_ISSUER_SOURCE_CONTEXT_DENIED/);
    assert.equal(requests.length,1); // No additional BCI/Buffer request.
  }finally{rmSync(dir,{recursive:true,force:true});}
});
