/**
 * PORTFOLIO_CURRENT_HEAD_BCI_BOUNDARY_20261027_1827
 * Coordinator-only, exact-commit integration. Synthetic JPEG and visitor events.
 * No provider attestation, approval, publication, database write or verified learning.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const pins={
  content:'9090bc394a42f886d3675f35ca93dbf633c3df1c',
  demand:'5a43590366f17c204e84bc4addf5bbacef9d918f',
  bci:'ddebb07d95258c2eec3cd87fe3ce7249c9a7e95c',
};
const files=[
  [pins.content,'lib/content/jpeg-source-qa.mjs'],
  [pins.demand,'lib/demand/concurrent-control-protocol.ts'],
  [pins.demand,'lib/demand/concurrent-exposure-audit.ts'],
  [pins.bci,'lib/bci/internal-lineage.ts'],
  [pins.bci,'lib/bci/audit-append-plan.ts'],
];
const tenantId='33333333-3333-4333-8333-333333333333';
const stages=['evidence','signal','case','diagnosis','decision','action','outcome','learning'];
function segment(marker,payload){
  const b=Buffer.alloc(payload.length+4);b[0]=255;b[1]=marker;
  b.writeUInt16BE(payload.length+2,2);payload.copy(b,4);return b;
}
function jpeg(){
  const frame=Buffer.alloc(15);frame[0]=8;frame.writeUInt16BE(2,1);
  frame.writeUInt16BE(2,3);frame[5]=3;
  return Buffer.concat([Buffer.from([255,216]),
    segment(0xdb,Buffer.from([0,1])),segment(0xc0,frame),
    segment(0xc4,Buffer.from([0,1])),
    segment(0xda,Buffer.from([3,1,0,2,0,3,0,0,63,0])),
    Buffer.alloc(80,3),Buffer.from([255,217])]);
}
function chain(product,key){
  const ids=stages.map((_,i)=>String(i+1).padStart(8,'0')+'-'+
    (product==='content'?'1111':'2222')+'-4111-8111-111111111111');
  return stages.map((stage,i)=>({id:ids[i],tenantId,product,stage,
    sourceSystem:'portfolio_synthetic',
    sourceRecordKey:i===0?key:'synthetic:'+product+':'+stage,
    recordedAt:'2026-10-27T10:'+String(i).padStart(2,'0')+':00Z',
    parentIds:i?[ids[i-1]]:[],verification:'unverified'}));
}
if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('exact-head integration runs only in GitHub Actions');
}else{
  test('latest CONTENT JPEG and DEMAND exposure reuse BCI without trust promotion',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-portfolio-current-'));
    try{
      execFileSync('git',['init','--quiet',dir],{stdio:'pipe',timeout:15000});
      execFileSync('git',['-C',dir,'remote','add','origin',
        'https://github.com/bolehejassolutions/bros-commercial-intelligence.git'],
        {stdio:'pipe',timeout:15000});
      for(const ref of new Set(Object.values(pins)))
        execFileSync('git',['-C',dir,'fetch','--no-tags','--depth=1','origin',ref],
          {stdio:'pipe',timeout:60000,maxBuffer:2097152});
      for(const [ref,path] of files){
        const src=execFileSync('git',['-C',dir,'show',ref+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const target=join(dir,path);mkdirSync(dirname(target),{recursive:true});
        writeFileSync(target,src,{mode:0o600});
      }
      const load=async p=>import(pathToFileURL(join(dir,p)).href);
      const {verifyDistinctJpegSources}=await load(files[0][1]);
      const {proposeDemandConcurrentControl}=await load(files[1][1]);
      const {auditDemandConcurrentExposureCandidates}=await load(files[2][1]);
      const {planUntrustedBciAuditAppend}=await load(files[4][1]);
      const media=verifyDistinctJpegSources([jpeg()],{expectedWidth:2,expectedHeight:2});
      assert.equal(media.status,'JPEG_SOURCE_STRUCTURE_VERIFIED_ONLY');
      assert.equal(media.images[0].decodedPixelIntegrityVerified,false);
      assert.equal(media.images[0].providerByteIdentityVerified,false);
      assert.equal(media.images[0].approvalVerified,false);
      assert.equal(media.publishedVerified,false);
      const proposal=proposeDemandConcurrentControl({tenantId,product:'demand',
        pilotProduct:'bros_sell',metaAccountId:'act_123456789',campaignId:'123456789',
        hypothesis:'Synthetic educational offer-clarity experiment, not executed.',
        action:'LANDING_PAGE_TEST',
        treatmentChange:'Synthetic alternative offer explanation, not published.',
        primaryKpi:'verified_paid_orders',plannedStart:'2026-10-29',
        plannedEnd:'2026-11-04',preRegisteredAt:'2026-10-27T07:00:00Z',
        evidenceCandidateIds:['meta_ads:sha256:'+'a'.repeat(64)],
        assignmentUnit:'CONSENTED_LANDING_VISITOR',
        assignmentMethod:'STICKY_RANDOM_50_50_PROPOSED',
        controlExperience:'UNCHANGED_EXISTING_LANDING_PAGE',
        analysisPolicy:'INTENTION_TO_TREAT',maxIncrementalSpendMinor:0});
      const event=(id,digest,kind,arm)=>({eventId:id,
        experimentCandidateId:proposal.candidateId,tenantId,product:'demand',
        visitorDigest:digest,kind,arm,observedAt:'2026-10-29T04:00:00Z',
        consentRecorded:true});
      const a='a'.repeat(64),b='b'.repeat(64);
      const events=[event('assign:a',a,'assignment','control'),
        event('expose:a',a,'exposure','control'),
        event('assign:b',b,'assignment','treatment'),
        event('expose:b',b,'exposure','treatment')];
      const exposure=auditDemandConcurrentExposureCandidates(proposal,events);
      assert.equal(exposure.structuralConsistency,true);
      assert.equal(exposure.status,'UNATTESTED_STRUCTURAL_REVIEW');
      assert.equal(exposure.candidateId,
        auditDemandConcurrentExposureCandidates(proposal,[...events].reverse()).candidateId);
      for(const key of ['ownerApprovalVerified','providerEvidenceAttested',
        'experimentExecutedVerified','outcomeVerified','learningVerified',
        'causalInferenceEligible','executionAllowed'])
        assert.equal(exposure[key],false,key);
      assert.equal(exposure.verifiedCacMinor,null);
      assert.equal(exposure.causalLift,null);
      const content=chain('content','content:jpeg:sha256:'+media.images[0].sha256);
      const demand=chain('demand',exposure.candidateId);
      for(const [product,records] of [['content',content],['demand',demand]]){
        const scope={tenantId,product};
        const plan=planUntrustedBciAuditAppend(scope,[],records);
        assert.equal(plan.toInsert.length,8);
        assert.equal(plan.structurallyLinkedLearnings,1);
        for(const key of ['authenticated','providerAttested','persisted'])
          assert.equal(plan[key],false,key);
        const replay=planUntrustedBciAuditAppend(scope,records,records);
        assert.equal(replay.toInsert.length,0);
        assert.equal(replay.replayedIds.length,8);
        assert.equal(replay.persisted,false);
        assert.throws(()=>planUntrustedBciAuditAppend(scope,[],[
          {...records[0],verification:'verified'},...records.slice(1)]),
          /Invalid BCI audit append/);
      }
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'demand'},[],content),/Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],demand),/Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId:'44444444-4444-4444-8444-444444444444',product:'content'},
        [],content),/Invalid BCI evidence lineage/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
