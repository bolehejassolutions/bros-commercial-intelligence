/**
 * PORTFOLIO_CONTENT_PLAN_DEMAND_READOUT_BCI_ISOLATION_20261028_V1
 * Coordinator-only exact-worker-commit contract test. Synthetic data only.
 * Neither a CONTENT plan nor a DEMAND sequential readout is an approved
 * provider event, verified outcome, persisted BCI record or learning.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const pins=Object.freeze({
  content:'3b969378fb2c187ca0a7212683c4166edb7db00d',
  demand:'a0cbd6e08bc44dd02cc1ca807ac45db3789df177',
  bci:'97cdac7fb6b6ddcde42c4ca11910b39764e94aac'
});
const sources=[
  [pins.content,'lib/content/instance-plan.mjs'],
  [pins.demand,'lib/demand/sequential-readout.ts'],
  [pins.demand,'lib/demand/experiment-preregistration.ts'],
  [pins.demand,'lib/demand/meta-insights-funnel.ts'],
  [pins.bci,'lib/bci/internal-lineage.ts'],
  [pins.bci,'lib/bci/audit-append-plan.ts']
];
const tenantId='33333333-3333-4333-8333-333333333333';
const at='2026-10-28T01:00:00Z';
const contentConfig=()=>({
  schemaVersion:1,product:'content',tenantId,instanceId:'flower-shop-1',
  brand:{displayName:'Independent Florist',voice:'Helpful and precise',
    locale:'ms-MY',claimCandidates:['Fresh flowers'],blockedClaims:['Guaranteed sales']},
  audience:{segment:'Local gift buyers',needs:['Clear ordering steps']},
  goals:['Explain ordering process'],
  channels:[{service:'instagram',channelId:'ig-florist'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,
    requiresEvidenceForClaims:true}
});
const brief=()=>({
  briefId:'flowers-brief-1',revisionId:'rev-1',
  channelService:'instagram',channelId:'ig-florist',
  format:'carousel',assetCount:3,topic:'How to order flowers',
  hypothesis:'Clear instructions may reduce confusion',
  hook:'How do you choose the right flowers?',
  measurementQuestion:'Are saves comparable at the same post age?'
});
const prereg=()=>({
  tenantId,product:'demand',pilotProduct:'bros_sell',
  metaAccountId:'act_1997776120879476',campaignId:'120250828102660697',
  hypothesis:'A clearer offer explanation may improve qualified decisions.',
  action:'LANDING_PAGE_TEST',primaryKpi:'verified_paid_orders',
  baselineStart:'2026-10-01',baselineEnd:'2026-10-07',
  experimentStart:'2026-10-28',experimentEnd:'2026-11-03',
  preRegisteredAt:'2026-10-27T03:00:00Z',
  evidenceCandidateIds:['meta_ads:sha256:'+'a'.repeat(64)],
  maxIncrementalSpendMinor:0
});
function scope(p,start,end){
  return {tenantId:p.tenantId,product:'demand',accountId:p.metaAccountId,
    campaignId:p.campaignId,currency:'MYR',since:start,until:end,
    collectedAt:'2026-11-05T00:00:00Z'};
}
function row(p,s,spend,clicks,views){
  return {campaign_id:p.campaignId,date_start:s.since,date_stop:s.until,
    spend,inline_link_clicks:clicks,
    actions:[{action_type:'landing_page_view',value:views}]};
}
function root(product,id,key){
  return {id,tenantId,product,stage:'evidence',sourceSystem:'portfolio_synthetic',
    sourceRecordKey:key,recordedAt:at,parentIds:[],verification:'unverified'};
}

if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('exact-worker-head integration runs in GitHub Actions');
}else{
  test('standalone CONTENT plan and DEMAND descriptive readout reuse BCI without cross-product trust promotion',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-portfolio-independent-'));
    try{
      execFileSync('git',['init','--quiet',dir],{timeout:15000});
      execFileSync('git',['-C',dir,'remote','add','origin',
        'https://github.com/bolehejassolutions/bros-commercial-intelligence.git'],
        {timeout:15000});
      for(const ref of new Set(Object.values(pins)))
        execFileSync('git',['-C',dir,'fetch','--no-tags','--depth=1','origin',ref],
          {timeout:60000,maxBuffer:2097152,stdio:'pipe'});
      for(const [ref,path] of sources){
        const src=execFileSync('git',['-C',dir,'show',ref+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const dest=join(dir,path);
        mkdirSync(dirname(dest),{recursive:true});
        writeFileSync(dest,src,{mode:0o600});
      }
      const load=async p=>import(pathToFileURL(join(dir,p)).href);
      const {planContentJobCandidate}=await load(sources[0][1]);
      const {prepareDemandSequentialReadout}=await load(sources[1][1]);
      const {planUntrustedBciAuditAppend}=await load(sources[5][1]);

      // CONTENT works independently with an unrelated non-SELL brand.
      const plan=planContentJobCandidate(contentConfig(),brief());
      assert.equal(plan.product,'content');
      assert.equal(plan.status,'PLANNED_ONLY');
      assert.equal(plan.independentImagesRequired,3);
      assert.equal(plan.executionAllowed,false);
      assert.equal(plan.providerSentVerified,false);
      assert.equal(plan.sharedBciAuditVerified,false);
      assert.equal(plan.planId,planContentJobCandidate(contentConfig(),brief()).planId);

      // DEMAND works without CONTENT: descriptive Meta-shaped rows only.
      const p=prereg();
      const baseline=scope(p,p.baselineStart,p.baselineEnd);
      const followup=scope(p,p.experimentStart,p.experimentEnd);
      const demand=prepareDemandSequentialReadout(p,baseline,
        row(p,baseline,'100.00',40,20),followup,
        row(p,followup,'120.00',45,25));
      assert.equal(demand.status,'DESCRIPTIVE_READOUT_UNATTESTED');
      assert.equal(demand.comparableCalendarWindows,true);
      assert.equal(demand.spendDeltaMinor,2000);
      assert.equal(demand.verifiedPaidOrders,null);
      assert.equal(demand.causalLift,null);
      assert.equal(demand.learningVerified,false);
      assert.equal(demand.executionAllowed,false);

      // Shared BCI accepts only explicit unverified, scoped root candidates.
      // No adapter/authorization/provider verification or durable writer exists here.
      const c=root('content','11111111-1111-4111-8111-111111111111',plan.planId);
      const d=root('demand','22222222-2222-4222-8222-222222222222',demand.candidateId);
      const cScope={tenantId,product:'content'};
      const dScope={tenantId,product:'demand'};
      const cPlan=planUntrustedBciAuditAppend(cScope,[],[c]);
      const dPlan=planUntrustedBciAuditAppend(dScope,[],[d]);
      assert.equal(cPlan.toInsert.length,1);
      assert.equal(dPlan.toInsert.length,1);
      assert.equal(cPlan.structurallyLinkedLearnings,0);
      assert.equal(dPlan.structurallyLinkedLearnings,0);
      for(const result of [cPlan,dPlan])
        for(const k of ['authenticated','providerAttested','persisted'])
          assert.equal(result[k],false,k);
      assert.equal(planUntrustedBciAuditAppend(cScope,[c],[c]).toInsert.length,0);
      assert.equal(planUntrustedBciAuditAppend(dScope,[d],[d]).toInsert.length,0);
      assert.throws(()=>planUntrustedBciAuditAppend(cScope,[],[c,d]),
        /Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(dScope,[],[c,d]),
        /Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(cScope,[],[d]),
        /Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(cScope,[],[c,{...d,product:'content'}]),
        /Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(cScope,[],[
        {...c,verification:'verified'}]),/Invalid BCI audit append/);
      assert.throws(()=>planUntrustedBciAuditAppend(dScope,[],[
        {...d,verification:'provider_reported'}]),/Invalid BCI audit append/);
      assert.throws(()=>planUntrustedBciAuditAppend(cScope,[],[plan]),
        /Invalid BCI audit append/);
      assert.throws(()=>planUntrustedBciAuditAppend(dScope,[],[demand]),
        /Invalid BCI audit append/);
      assert.throws(()=>planUntrustedBciAuditAppend({
        tenantId:'44444444-4444-4444-8444-444444444444',product:'content'
      },[],[c]),/Invalid BCI evidence lineage/);
    }finally{rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
  });
}
