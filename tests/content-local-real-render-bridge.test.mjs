import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planContentJobCandidate} from '../lib/content/instance-plan.mjs';
import {bindLocalContentRenderToPlan} from '../lib/content/local-render-manifest-gate.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const config={
  schemaVersion:1,product:'content',tenantId:'tenant-internal',
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
  {skip:hasPillow?false:'Pillow unavailable; real bridge runs in dedicated CONTENT CI'},()=>{
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
    const replay=bindLocalContentRenderToPlan(config,brief,manifest,buffers);
    assert.equal(bound.mediaSetId,replay.mediaSetId);
    const forged=structuredClone(manifest);
    forged.images[0].decodedRgbSha256='0'.repeat(64);
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
