import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,sign} from 'node:crypto';
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
  }finally{rmSync(dir,{recursive:true,force:true});}
});
