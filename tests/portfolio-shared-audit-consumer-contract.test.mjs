/**
 * PORTFOLIO_SHARED_AUDIT_CONSUMER_CONTRACT_20261027_1420
 * Coordinator-only, pinned cross-branch consumer test. SYNTHETIC inputs.
 * Never authenticates Buffer/Meta, writes Neon, grants approval, or executes ads.
 * An eight-stage structural lineage is NOT verified outcome or durable audit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const pins=Object.freeze({
  content:'42e75052e05aaba25eb10d54f04f0d0a04dfdbb9',
  demand:'b6bb3e6864689e55bdbb86ee854c28df9d3014ab',
  bci:'878f03383419f24726d1413ee411a6328776a82b',
});
const sources=[
  [pins.content,'lib/content/buffer-observation.mjs'],
  [pins.content,'lib/content/measurement-revision.mjs'],
  [pins.demand,'lib/demand/experiment-preregistration.ts'],
  [pins.bci,'lib/bci/internal-lineage.ts'],
  [pins.bci,'lib/bci/audit-append-plan.ts'],
];
const tenantId='33333333-3333-4333-8333-333333333333';
const stages=['evidence','signal','case','diagnosis','decision','action','outcome','learning'];
const chain=(product,sourceKey)=>{
  const ids=stages.map((_,i)=>
    String(i+1).padStart(8,'0')+'-'+(product==='content'?'1111':'2222')+
    '-4111-8111-111111111111');
  return stages.map((stage,i)=>({
    id:ids[i],tenantId,product,stage,sourceSystem:'portfolio_synthetic',
    sourceRecordKey:i===0?sourceKey:'synthetic:'+product+':'+stage,
    recordedAt:'2026-10-27T06:'+String(i).padStart(2,'0')+':00Z',
    parentIds:i?[ids[i-1]]:[],verification:'unverified',
  }));
};

if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('pinned cross-branch consumer contract runs in GitHub Actions');
}else{
  test('latest CONTENT and DEMAND candidates reuse ONE BCI audit planner without false-green promotion',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-portfolio-audit-'));
    try{
      // A private disposable git directory avoids concurrent shallow-fetch locks.
      execFileSync('git',['init','--quiet',dir],{stdio:'pipe',timeout:15000});
      execFileSync('git',['-C',dir,'remote','add','origin',
        'https://github.com/bolehejassolutions/bros-commercial-intelligence.git'],
        {stdio:'pipe',timeout:15000});
      for(const ref of new Set(Object.values(pins))){
        execFileSync('git',['-C',dir,'fetch','--no-tags','--depth=1','origin',ref],
          {stdio:'pipe',timeout:60000,maxBuffer:2097152});
      }
      for(const [ref,path] of sources){
        const src=execFileSync('git',['-C',dir,'show',ref+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const file=join(dir,path);
        mkdirSync(dirname(file),{recursive:true});
        writeFileSync(file,src,{mode:0o600});
      }
      const load=async path=>import(pathToFileURL(join(dir,path)).href);
      const {projectBufferContentObservation}=await load(sources[0][1]);
      const {proposeContentMeasurementRevision}=await load(sources[1][1]);
      const {preregisterDemandExperiment}=await load(sources[2][1]);
      const {planUntrustedBciAuditAppend}=await load(sources[4][1]);

      const contentScope={tenantId,product:'content',instanceId:'sell-internal',
        contentId:'synthetic-content-001',channelService:'instagram',
        channelId:'ig-synthetic-001',expectedAssetCount:2,
        asOf:'2026-10-27T06:20:00Z'};
      const post={id:'synthetic-post-001',status:'sent',channelService:'instagram',
        channelId:contentScope.channelId,sentAt:'2026-10-27T01:03:43.741Z',
        externalLink:'https://www.instagram.com/p/DeyLqz7EYPk/',
        text:'Seller education synthetic',metadata:{isAiGenerated:false},
        assets:[{type:'image',source:'https://example.com/slide-1.png'},
          {type:'image',source:'https://example.com/slide-2.png'}],
        metricsUpdatedAt:'2026-10-27T02:03:43.741Z',
        metrics:[{type:'views',unit:'count',value:6}]};
      const previous=projectBufferContentObservation(post,contentScope);
      const current=projectBufferContentObservation({...post,
        metricsUpdatedAt:'2026-10-27T04:03:43.741Z',
        metrics:[{type:'views',unit:'count',value:8}]},contentScope);
      assert.equal(previous.status,'MEASURED');
      assert.equal(current.status,'MEASURED');
      const contentCandidate=proposeContentMeasurementRevision(previous,current,{
        ...contentScope,postId:post.id,
      });
      assert.equal(contentCandidate.status,'CANDIDATE_UNATTESTED');
      assert.equal(contentCandidate.observedDeltas.views,2);
      for(const flag of ['providerAttested','approvalVerified','bciAuditWritten',
        'learningVerified','causalLiftProven','executionAllowed'])
        assert.equal(contentCandidate[flag],false,flag);

      const demandCandidate=preregisterDemandExperiment({
        tenantId,product:'demand',pilotProduct:'bros_sell',
        metaAccountId:'act_1997776120879476',campaignId:'123456789',
        hypothesis:'Synthetic concurrent creative test proposal, not executed',
        action:'CREATIVE_TEST',primaryKpi:'verified_paid_orders',
        baselineStart:'2026-10-01',baselineEnd:'2026-10-07',
        experimentStart:'2026-10-29',experimentEnd:'2026-11-05',
        preRegisteredAt:'2026-10-27T06:00:00Z',
        evidenceCandidateIds:['demand:synthetic:meta:01'],
        maxIncrementalSpendMinor:0,
      });
      assert.equal(demandCandidate.status,'PROPOSED_NOT_AUTHORIZED');
      assert.equal(demandCandidate.experimentDesign,'SEQUENTIAL_BASELINE_NOT_CONTROLLED');
      for(const flag of ['controlledExperimentVerified','causalInferenceEligible',
        'providerEvidenceAttested','tenantAuthorizationVerified','actionApproved',
        'actionExecuted','outcomeVerified','learningVerified','executionAllowed'])
        assert.equal(demandCandidate[flag],false,flag);
      assert.equal(demandCandidate.verifiedPaidOrders,null);
      assert.equal(demandCandidate.causalLift,null);

      // Same shared BCI planner, separate tenant/product scopes and source keys.
      for(const [product,candidateKey] of [
        ['content',contentCandidate.candidateId],
        ['demand',demandCandidate.candidateId],
      ]){
        const scope={tenantId,product},records=chain(product,candidateKey);
        const first=planUntrustedBciAuditAppend(scope,[],records);
        assert.equal(first.toInsert.length,8);
        assert.equal(first.structurallyLinkedLearnings,1);
        assert.deepEqual(first.replayedIds,[]);
        for(const flag of ['authenticated','providerAttested','persisted'])
          assert.equal(first[flag],false,flag);
        // The persisted parameter here is a hypothetical in-memory fixture,
        // NOT a readback from Neon or proof of a durable audit.
        const replay=planUntrustedBciAuditAppend(scope,records,records);
        assert.equal(replay.toInsert.length,0);
        assert.equal(replay.replayedIds.length,8);
        assert.equal(replay.persisted,false);
        assert.throws(()=>planUntrustedBciAuditAppend(scope,[],[
          {...records[0],verification:'verified'},...records.slice(1)]),
          /Invalid BCI audit append/);
        assert.throws(()=>planUntrustedBciAuditAppend({
          ...scope,product:product==='content'?'demand':'content'
        },[],records),/Invalid BCI evidence lineage/);
        assert.throws(()=>planUntrustedBciAuditAppend({
          ...scope,tenantId:'55555555-5555-4555-8555-555555555555'
        },[],records),/Invalid BCI evidence lineage/);
      }
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
