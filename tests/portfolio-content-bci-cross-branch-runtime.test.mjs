/**
 * PORTFOLIO_CONTENT_BCI_COMBINED_RUNTIME_20261027_1322
 * Coordinator-only contract integration using exact CONTENT and BCI source commits.
 * Synthetic Buffer-shaped observations; no authenticated provider call, approval,
 * publication, media-byte attestation, BCI write, or customer release.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const contentRef='e3e7b859345b17c2e90c6840cc50c22733964f34';
const bciRef='f9f8887c78a21c9eedb6bb48d7ed87019b2d5b99';
const sources=[
  [contentRef,'lib/content/buffer-observation.mjs'],
  [bciRef,'lib/bci/unattested-content-handoff.ts'],
  [bciRef,'lib/bci/evidence-envelope.ts'],
];
const tenantId='33333333-3333-4333-8333-333333333333';
const scope={tenantId,product:'content',instanceId:'sell-internal',
  contentId:'synthetic-content-001',channelService:'instagram',
  channelId:'ig-synthetic-001',expectedAssetCount:2,
  asOf:'2026-10-27T05:20:00Z'};
const post={id:'synthetic-post-001',status:'sent',channelService:'instagram',
  channelId:scope.channelId,sentAt:'2026-10-27T01:03:43.741Z',
  externalLink:'https://www.instagram.com/p/DeyLqz7EYPk/',
  text:'Seller education, synthetic fixture',metadata:{isAiGenerated:false},
  assets:[{type:'image',source:'https://example.com/slide-1.png'},
    {type:'image',source:'https://example.com/slide-2.png'}],
  metricsUpdatedAt:'2026-10-27T04:03:43.741Z',
  metrics:[{type:'views',unit:'count',value:6},
    {type:'reach',unit:'count',value:4},
    {type:'reactions',unit:'count',value:0}]};

if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('pinned CONTENT→BCI runtime is executed only by GitHub Actions');
}else{
  test('actual CONTENT observation → handoff → shared BCI envelope remains unverified',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-content-bci-'));
    try{
      // Isolate Git's shallow metadata from concurrent Node test files.
      // The earlier CI failure came from simultaneous fetches in checkout's .git.
      execFileSync('git',['init','--quiet',dir],{stdio:'pipe',timeout:15000});
      execFileSync('git',['-C',dir,'remote','add','origin',
        'https://github.com/bolehejassolutions/bros-commercial-intelligence.git'],
        {stdio:'pipe',timeout:15000});
      for(const ref of [contentRef,bciRef])
        execFileSync('git',['-C',dir,'fetch','--no-tags','--depth=1','origin',ref],
          {stdio:'pipe',timeout:60000,maxBuffer:2097152});
      for(const [ref,path] of sources){
        const src=execFileSync('git',['-C',dir,'show',ref+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const file=join(dir,path);
        mkdirSync(dirname(file),{recursive:true});
        writeFileSync(file,src,{mode:0o600});
      }
      const load=async path=>import(pathToFileURL(join(dir,path)).href);
      const {projectBufferContentObservation:observe,
        buildContentBciEvidenceHandoff:handoff}=await load(sources[0][1]);
      const {projectUnattestedContentHandoff:project}=await load(sources[1][1]);
      const {normalizeEvidenceEnvelope:normalize}=await load(sources[2][1]);
      const trusted={tenantId,product:'content'};
      const collectedAt='2026-10-27T05:00:00Z';
      const observed=observe(post,scope);
      assert.equal(observed.status,'MEASURED');
      const candidate=handoff(observed,scope,collectedAt);
      const result=project(candidate,trusted);
      assert.deepEqual(result.envelope,normalize(result.envelope));
      assert.equal(result.envelope.provider,'buffer');
      assert.equal(result.envelope.product,'content');
      assert.equal(result.envelope.tenantId,tenantId);
      assert.equal(result.envelope.providerRecordKey,candidate.evidenceId);
      assert.equal(result.envelope.provenance,'synthetic');
      assert.equal(result.envelope.environment,'unknown');
      assert.deepEqual([result.envelope.metrics.views,
        result.envelope.metrics.reach,result.envelope.metrics.reactions,
        result.envelope.metrics.clicks],[6,4,0,null]);
      for(const flag of ['authenticated','providerAttested','approvalVerified','persisted'])
        assert.equal(result[flag],false,flag);
      assert.ok(candidate.unknowns.includes('NATIVE_MEDIA_BYTES_UNVERIFIED'));
      assert.ok(candidate.unknowns.includes('SHARED_BCI_AUDIT_NOT_WRITTEN'));
      const replay=project(handoff(observe({...post},scope),scope,
        '2026-10-27T05:10:00Z'),trusted);
      assert.deepEqual(replay.envelope,result.envelope);

      // SENT with no post-SENT metric snapshot remains unmeasured, never zero.
      const unmeasured=observe({...post,metricsUpdatedAt:null,metrics:null},scope);
      assert.equal(unmeasured.status,'SENT_UNMEASURED');
      const unknown=project(handoff(unmeasured,scope,collectedAt),trusted);
      assert.ok(Object.values(unknown.envelope.metrics).every(v=>v===null));
      assert.notEqual(unknown.envelope.providerRecordKey,result.envelope.providerRecordKey);
      assert.ok(unknown.envelope.observedAt===post.sentAt);
      assert.ok(unknown.envelope.provenance==='synthetic');

      // Neither scheduled nor invalid/stale native provider observations
      // may cross the handoff boundary.
      for(const unsafe of [
        {...post,status:'scheduled'},
        {...post,metricsUpdatedAt:'2026-10-26T00:00:00Z'},
        {...post,externalLink:'https://www.instagram.com/accounts/login/'},
        {...post,metadata:{isAiGenerated:false},
          text:'Ilustrasi AI, synthetic fixture'},
      ]){
        const held=observe(unsafe,scope);
        assert.notEqual(held.status,'MEASURED');
        assert.throws(()=>handoff(held,scope,collectedAt));
      }
      for(const forged of [
        {...candidate,tenantId:'22222222-2222-4222-8222-222222222222'},
        {...candidate,product:'demand'},
        {...candidate,approvalVerified:true},
        {...candidate,provenance:{...candidate.provenance,completeness:'verified'}},
      ]) assert.throws(()=>project(forged,trusted),
        /Invalid unattested CONTENT handoff/);
      assert.throws(()=>project(candidate,{...trusted,product:'demand'}),
        /Invalid unattested CONTENT handoff/);
      assert.throws(()=>project(candidate,{...trusted,admin:true}),
        /Invalid unattested CONTENT handoff/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
