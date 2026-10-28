/**
 * PORTFOLIO_DEMAND_CASE_BCI_UNTRUSTED_20261028_V1
 * Coordinator contract at exact DEMAND and BCI worker commits. Synthetic-only.
 * A diagnosis/action proposal and a complete structural lineage do not attest
 * payment attribution, approval, execution, causal outcome or learning.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const pins=Object.freeze({
  demand:'60e6bd77a6a416afc7ad76b349c13e31d51f180a',
  bci:'6d870dd16023370de307eb4fe89050c38ecdf9cc'
});
const sources=[
  [pins.demand,'lib/demand/acquisition-case-packet.ts'],
  [pins.demand,'lib/demand/historical-acquisition-evidence.ts'],
  [pins.demand,'lib/demand/experiment-preregistration.ts'],
  [pins.demand,'lib/demand/meta-insights-funnel.ts'],
  [pins.demand,'lib/demand/hitpay-order-charge.ts'],
  [pins.bci,'lib/bci/internal-lineage.ts'],
  [pins.bci,'lib/bci/audit-append-plan.ts']
];
const tenantId='11111111-1111-4111-8111-111111111111';
const scope={tenantId,product:'demand',accountId:'act_1997776120879476',
  campaignId:'120250864977630697',currency:'MYR',
  since:'2026-10-09',until:'2026-10-09',collectedAt:'2026-10-28T05:00:00Z'};
const meta={campaign_id:scope.campaignId,date_start:scope.since,
  date_stop:scope.until,spend:'4.32',inline_link_clicks:'1',
  actions:[{action_type:'purchase',value:'1'},
    {action_type:'omni_purchase',value:'1'},
    {action_type:'offsite_conversion.fb_pixel_purchase',value:'1'},
    {action_type:'landing_page_view',value:'1'}]};
const order={id:'22222222-2222-4222-8222-222222222222',
  order_display_number:1007,amount:5000,currency:'myr',
  status:'completed',payment_status:'paid',fulfilment_status:'completed'};
const charge={id:'33333333-3333-4333-8333-333333333333',
  amount:5000,currency:'myr',status:'succeeded',remark:'Order #'+order.id};
const detail={id:charge.id,amount:50,amount_without_fees:48.3,
  refunded_amount:0,currency:'myr',status:'succeeded',
  remark:charge.remark,order_reference_number:'1007',payout:null};
const experiment=(pairKey)=>({
  tenantId,product:'demand',pilotProduct:'bros_sell',
  metaAccountId:scope.accountId,campaignId:scope.campaignId,
  hypothesis:'Clear explanations may improve qualified acquisition.',
  action:'LANDING_PAGE_TEST',primaryKpi:'verified_paid_orders',
  baselineStart:scope.since,baselineEnd:scope.until,
  experimentStart:'2026-11-01',experimentEnd:'2026-11-07',
  preRegisteredAt:'2026-10-28T05:10:00Z',
  evidenceCandidateIds:[pairKey],maxIncrementalSpendMinor:0
});
const stageNames=['evidence','signal','case','diagnosis','decision','action','outcome','learning'];
const uid=(i)=>String(i).padStart(8,'0')+'-1111-4111-8111-111111111111';
function syntheticLineage(packet){
  return stageNames.map((stage,i)=>({
    id:uid(i+1),tenantId,product:'demand',stage,
    sourceSystem:'synthetic_untrusted_demand',
    sourceRecordKey:i===0?packet.sourceEvidenceCandidateIds[2]:
      i===2?packet.caseId:stage+'-fixture-'+i,
    recordedAt:'2026-10-28T05:00:00Z',
    parentIds:i===0?[]:[uid(i)],verification:'unverified'
  }));
}

if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('exact-worker-commit contract executes in GitHub Actions');
}else{
  test('DEMAND diagnosis packet cannot become verified BCI action or learning by structural ancestry',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-demand-case-bci-'));
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
        const target=join(dir,path);
        mkdirSync(dirname(target),{recursive:true});
        writeFileSync(target,src,{mode:0o600});
      }
      const load=async p=>import(pathToFileURL(join(dir,p)).href);
      const {reviewDemandAcquisitionEvidencePair}=await load(sources[1][1]);
      const {prepareDemandAcquisitionCasePacket}=await load(sources[0][1]);
      const {planUntrustedBciAuditAppend}=await load(sources[6][1]);
      const pair=reviewDemandAcquisitionEvidencePair(scope,meta,order,charge,detail);
      // Coordinator gate: current DEMAND head rejects a provider snapshot
      // collected after a purported experiment preregistration. The older
      // coordinator fixture (04:00Z prereg / 05:00Z collection) was invalid.
      // A rejected packet must never be promoted to shared BCI evidence.
      assert.throws(()=>prepareDemandAcquisitionCasePacket(
        scope,meta,order,charge,detail,
        {...experiment(pair.pairKey),preRegisteredAt:'2026-10-28T04:59:59Z'}),
        /Invalid BROS DEMAND acquisition case chronology/);
      const packet=prepareDemandAcquisitionCasePacket(scope,meta,order,charge,
        detail,experiment(pair.pairKey));
      const repeated=prepareDemandAcquisitionCasePacket(scope,meta,order,charge,
        detail,experiment(pair.pairKey));
      assert.deepEqual(packet,repeated);
      assert.equal(packet.status,'UNATTESTED_NOT_AUTHORIZED');
      assert.equal(packet.stage,'DIAGNOSIS_AND_ACTION_PROPOSAL_ONLY');
      assert.equal(packet.executionAllowed,false);
      assert.equal(packet.ownerApprovalVerified,false);
      assert.equal(packet.providerAuthenticationVerified,false);
      assert.equal(packet.metaEventToOrderJoinVerified,false);
      assert.equal(packet.hitpaySettlementVerified,false);
      assert.equal(packet.outcomeVerified,false);
      assert.equal(packet.learningVerified,false);
      assert.equal(packet.verifiedCacMinor,null);
      assert.equal(packet.causalLift,null);
      assert.equal(packet.maxIncrementalSpendMinor,0);
      assert.equal(JSON.stringify(packet).includes(order.id),false);
      assert.equal(JSON.stringify(packet).includes(charge.id),false);
      const bciScope={tenantId,product:'demand'};
      assert.throws(()=>planUntrustedBciAuditAppend(bciScope,[],[packet]),
        /Invalid BCI audit append/);
      const chain=syntheticLineage(packet);
      const planned=planUntrustedBciAuditAppend(bciScope,[],chain);
      assert.equal(planned.toInsert.length,8);
      assert.equal(planned.structurallyLinkedLearnings,1);
      assert.equal(planned.authenticated,false);
      assert.equal(planned.providerAttested,false);
      assert.equal(planned.persisted,false);
      assert.ok(planned.toInsert.every(x=>x.verification==='unverified'));
      assert.equal(planUntrustedBciAuditAppend(bciScope,chain,chain).toInsert.length,0);
      assert.throws(()=>planUntrustedBciAuditAppend(bciScope,[],[
        ...chain.slice(0,7),{...chain[7],verification:'verified'}]),
        /Invalid BCI audit append/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],chain),/Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId:'44444444-4444-4444-8444-444444444444',product:'demand'},
        [],chain),/Invalid BCI evidence lineage/);
      const revisedMeta={...meta,spend:'4.33'};
      const revisedPair=reviewDemandAcquisitionEvidencePair(
        scope,revisedMeta,order,charge,detail);
      assert.throws(()=>prepareDemandAcquisitionCasePacket(
        scope,revisedMeta,order,charge,detail,experiment(pair.pairKey)),
        /Invalid BROS DEMAND acquisition case linkage/);
      const revisedPacket=prepareDemandAcquisitionCasePacket(
        scope,revisedMeta,order,charge,detail,experiment(revisedPair.pairKey));
      assert.notEqual(revisedPacket.caseId,packet.caseId);
      assert.equal(revisedPacket.learningVerified,false);
    }finally{
      rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:150});
    }
  });
}
