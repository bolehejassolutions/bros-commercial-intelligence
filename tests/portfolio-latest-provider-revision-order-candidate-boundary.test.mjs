/**
 * PORTFOLIO_PROVIDER_REVISION_ORDER_CANDIDATE_BOUNDARY_20261027_1926
 * Coordinator-owned exact-source acceptance test; all fixtures are SYNTHETIC.
 * A provider-shaped metric revision or checkout candidate is not provider
 * authentication, CONTENT approval, a settled order, or durable BCI learning.
 * No Neon writes, provider mutations, new auth backend or publication.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const pins=Object.freeze({
  content:'3f42b89f5b42f9e307cc133c6a05d35e23a7fa31',
  demand:'deb620aacc178e9b3755fefd4aef56f9b7017814',
  bci:'b0f11e889693a9aaa167028443aadbcddcdf3929',
});
const sources=[
  [pins.content,'lib/content/buffer-observation.mjs'],
  [pins.demand,'lib/demand/concurrent-control-protocol.ts'],
  [pins.demand,'lib/demand/concurrent-exposure-audit.ts'],
  [pins.demand,'lib/demand/concurrent-order-candidate-audit.ts'],
  [pins.bci,'lib/bci/internal-lineage.ts'],
  [pins.bci,'lib/bci/audit-append-plan.ts'],
];
const tenantId='33333333-3333-4333-8333-333333333333';
const stages=['evidence','signal','case','diagnosis','decision','action','outcome','learning'];
function chain(product,key){
  const ids=stages.map((_,i)=>String(i+1).padStart(8,'0')+'-'+
    (product==='content'?'1111':'2222')+'-4111-8111-111111111111');
  return stages.map((stage,i)=>({
    id:ids[i],tenantId,product,stage,sourceSystem:'portfolio_synthetic',
    sourceRecordKey:i===0?key:'synthetic:'+product+':'+stage,
    recordedAt:'2026-10-27T10:'+String(i).padStart(2,'0')+':00Z',
    parentIds:i?[ids[i-1]]:[],verification:'unverified',
  }));
}

if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('exact-commit cross-branch acceptance runs in GitHub Actions');
}else{
  test('stale CONTENT metric detail and DEMAND order candidates cannot authorize shared BCI outcomes',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-portfolio-revision-order-'));
    try{
      execFileSync('git',['init','--quiet',dir],{stdio:'pipe',timeout:15000});
      execFileSync('git',['-C',dir,'remote','add','origin',
        'https://github.com/bolehejassolutions/bros-commercial-intelligence.git'],
        {stdio:'pipe',timeout:15000});
      for(const ref of new Set(Object.values(pins)))
        execFileSync('git',['-C',dir,'fetch','--no-tags','--depth=1','origin',ref],
          {stdio:'pipe',timeout:60000,maxBuffer:2097152});
      for(const [ref,path] of sources){
        const src=execFileSync('git',['-C',dir,'show',ref+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const target=join(dir,path);
        mkdirSync(dirname(target),{recursive:true});
        writeFileSync(target,src,{mode:0o600});
      }
      const load=async path=>import(pathToFileURL(join(dir,path)).href);
      const {reconcileBufferListAndDetail,buildContentBciEvidenceHandoff}
        =await load(sources[0][1]);
      const {proposeDemandConcurrentControl}=await load(sources[1][1]);
      const {auditDemandOrderExposureCandidates}=await load(sources[3][1]);
      const {planUntrustedBciAuditAppend}=await load(sources[5][1]);

      const scope={tenantId,product:'content',instanceId:'sell-internal',
        contentId:'synthetic-content-revision',channelService:'instagram',
        channelId:'ig-synthetic',expectedAssetCount:1,
        asOf:'2026-10-27T11:00:00Z'};
      const post={id:'synthetic-post-revision',status:'sent',
        channelService:'instagram',channelId:scope.channelId,
        sentAt:'2026-10-27T09:00:00Z',dueAt:'2026-10-27T09:00:00Z',
        text:'Synthetic educational seller content',metadata:{isAiGenerated:false},
        externalLink:'https://www.instagram.com/p/ABC/',
        assets:[{id:'asset-1',type:'image',mimeType:'image/jpeg',
          source:'https://example.com/synthetic.jpg'}],
        metricsUpdatedAt:'2026-10-27T10:10:00Z',
        metrics:[{type:'views',unit:'count',value:4}]};
      const list={...post,metricsUpdatedAt:'2026-10-27T10:30:00Z',
        metrics:[{type:'views',unit:'count',value:6}]};
      // Latest list has newer metrics than detail. Must fail rather than
      // falling back to old get_post or presenting list as authenticated.
      assert.throws(()=>reconcileBufferListAndDetail(list,post,scope),
        /BUFFER_DETAIL_METRICS_STALE/);
      const newerDetail={...post,metricsUpdatedAt:'2026-10-27T10:40:00Z',
        metrics:[{type:'views',unit:'count',value:7}]};
      const hydrated=reconcileBufferListAndDetail(list,newerDetail,scope);
      assert.equal(hydrated.status,'MEASURED');
      assert.equal(hydrated.observation.metrics.views,7);
      assert.equal(hydrated.providerAttestedByModule,false);
      assert.equal(hydrated.approvalVerified,false);
      assert.equal(hydrated.executionAllowed,false);
      const handoff=buildContentBciEvidenceHandoff(hydrated.observation,
        scope,'2026-10-27T10:50:00Z');
      assert.equal(handoff.provenance.completeness,'unverified');
      assert.ok(handoff.unknowns.includes('SHARED_BCI_AUDIT_NOT_WRITTEN'));
      assert.equal(handoff.metrics.views,7);

      const proposal=proposeDemandConcurrentControl({
        tenantId,product:'demand',pilotProduct:'bros_sell',
        metaAccountId:'act_123456789',campaignId:'123456789',
        hypothesis:'Synthetic offer-clarity holdout, never executed.',
        action:'LANDING_PAGE_TEST',
        treatmentChange:'Synthetic alternative offer explanation, unpublished.',
        primaryKpi:'verified_paid_orders',plannedStart:'2026-10-29',
        plannedEnd:'2026-11-04',preRegisteredAt:'2026-10-27T07:00:00Z',
        evidenceCandidateIds:['meta_ads:sha256:'+'a'.repeat(64)],
        assignmentUnit:'CONSENTED_LANDING_VISITOR',
        assignmentMethod:'STICKY_RANDOM_50_50_PROPOSED',
        controlExperience:'UNCHANGED_EXISTING_LANDING_PAGE',
        analysisPolicy:'INTENTION_TO_TREAT',maxIncrementalSpendMinor:0});
      const a='a'.repeat(64),b='b'.repeat(64);
      const exposure=(eventId,digest,kind,arm)=>({
        eventId,experimentCandidateId:proposal.candidateId,
        tenantId,product:'demand',visitorDigest:digest,kind,arm,
        observedAt:'2026-10-29T04:00:00Z',consentRecorded:true});
      const events=[
        exposure('assign:control',a,'assignment','control'),
        exposure('expose:control',a,'exposure','control'),
        exposure('assign:treatment',b,'assignment','treatment'),
        exposure('expose:treatment',b,'exposure','treatment'),
      ];
      const order=(eventId,digest,arm,hash)=>({
        eventId,experimentCandidateId:proposal.candidateId,
        tenantId,product:'demand',pilotProduct:'bros_sell',
        visitorDigest:digest,arm,
        orderCandidateKey:'demand:hitpay-candidate:sha256:'+hash,
        observedAt:'2026-10-29T06:00:00Z'});
      const good=[
        order('checkout:control',a,'control','c'.repeat(64)),
        order('checkout:treatment',b,'treatment','d'.repeat(64)),
      ];
      const clean=auditDemandOrderExposureCandidates(proposal,events,good);
      assert.equal(clean.structuralConsistency,true);
      assert.equal(clean.controlOrderCandidates,1);
      assert.equal(clean.treatmentOrderCandidates,1);
      const duplicate=auditDemandOrderExposureCandidates(proposal,events,[
        good[0],order('checkout:treatment',b,'treatment','c'.repeat(64))]);
      assert.equal(duplicate.structuralConsistency,false);
      assert.ok(duplicate.findings.includes('DUPLICATE_ORDER_CANDIDATE'));
      assert.notEqual(clean.candidateId,duplicate.candidateId);
      for(const candidate of [clean,duplicate]){
        assert.equal(candidate.status,'UNATTESTED_ORDER_EXPOSURE_JOIN');
        for(const k of ['providerAuthenticationVerified','tenantMembershipVerified',
          'ownerApprovalVerified','actionExecutedVerified','hitpaySettlementVerified',
          'entitlementVerified','attributionVerified','outcomeVerified',
          'learningVerified','causalInferenceEligible','executionAllowed'])
          assert.equal(candidate[k],false,k);
        for(const k of ['verifiedPaidOrders','settledOrders',
          'verifiedConversionRate','verifiedCacMinor','causalLift'])
          assert.equal(candidate[k],null,k);
      }

      // One BCI planner, independent CONTENT and DEMAND product scopes.
      // Structural "learning" is not a provider-attested business learning.
      const content=chain('content',handoff.evidenceId);
      const demand=chain('demand',clean.candidateId);
      for(const [product,rows] of [['content',content],['demand',demand]]){
        const scoped={tenantId,product};
        const plan=planUntrustedBciAuditAppend(scoped,[],rows);
        assert.equal(plan.toInsert.length,8);
        assert.equal(plan.structurallyLinkedLearnings,1);
        assert.equal(plan.authenticated,false);
        assert.equal(plan.providerAttested,false);
        assert.equal(plan.persisted,false);
        assert.equal(planUntrustedBciAuditAppend(scoped,rows,rows).toInsert.length,0);
        assert.throws(()=>planUntrustedBciAuditAppend(scoped,[],[
          {...rows[0],verification:'verified'},...rows.slice(1)]),
          /Invalid BCI audit append/);
      }
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],demand),/Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'demand'},[],content),/Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId:'44444444-4444-4444-8444-444444444444',product:'content'},
        [],content),/Invalid BCI evidence lineage/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
