/**
 * PORTFOLIO_DEMAND_BCI_COMBINED_RUNTIME_20261027
 * Coordinator-only actual cross-branch runtime, pinned sources, synthetic fixtures.
 * No branch merge, provider call, credential, database write, or verified conversion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const demandRef='6c17d062730b65bb8bb4d9ff8d20e674ef44edfd';
const bciRef='fd98254aabf2edf47f0fbfd1dbc83cb2334880d5';
const sources=[
  [demandRef,'lib/demand/hitpay-order-charge.ts'],
  [bciRef,'lib/bci/unattested-hitpay-handoff.ts'],
  [bciRef,'lib/bci/evidence-envelope.ts'],
];
const scope={tenantId:'33333333-3333-4333-8333-333333333333',product:'demand'};
const order={id:'11111111-1111-4111-8111-111111111111',order_display_number:1007,
  amount:5000,currency:'myr',status:'completed',payment_status:'paid',fulfilment_status:'completed'};
const charge={id:'22222222-2222-4222-8222-222222222222',amount:5000,
  currency:'myr',status:'succeeded',remark:'Order #'+order.id};
const detail={id:charge.id,amount:50,amount_without_fees:48.3,refunded_amount:0,
  currency:'myr',status:'succeeded',remark:charge.remark,order_reference_number:'1007',payout:null};

// Offline developer tests do not fetch network. GitHub Actions must run this.
if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('pinned cross-branch runtime runs in GitHub Actions only');
}else{
  test('real DEMAND source -> BCI mapper -> BCI envelope, no false verification',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-cross-branch-'));
    try{
      for(const ref of [demandRef,bciRef])
        execFileSync('git',['fetch','--no-tags','--depth=1','origin',ref],
          {stdio:'pipe',timeout:60000,maxBuffer:2097152});
      for(const [ref,path] of sources){
        const src=execFileSync('git',['show',ref+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const file=join(dir,path);
        mkdirSync(dirname(file),{recursive:true});
        writeFileSync(file,src,{mode:0o600});
      }
      const load=async path=>import(pathToFileURL(join(dir,path)).href);
      const {reconcileDemandHitPayOrderCharge:reconcile}=await load(sources[0][1]);
      const {projectUnattestedDemandHitPayHandoff:project}=await load(sources[1][1]);
      const {normalizeEvidenceEnvelope:normalize}=await load(sources[2][1]);
      const at='2026-10-27T04:20:00Z';
      const candidate=reconcile(order,charge,detail);
      assert.equal(candidate.status,'PROVIDER_REPORTED_PAID');
      assert.deepEqual([candidate.grossMinor,candidate.feeMinor,candidate.netMinor],[5000,170,4830]);
      const result=project(candidate,scope,at);
      assert.deepEqual(result.envelope,normalize(result.envelope));
      assert.equal(result.sourceProvider,'hitpay');
      assert.equal(result.sourceCandidateKey,candidate.candidateKey);
      assert.equal(result.envelope.provider,'other');
      assert.equal(result.envelope.product,'demand');
      assert.equal(result.envelope.tenantId,scope.tenantId);
      assert.equal(result.envelope.provenance,'synthetic');
      assert.equal(result.envelope.environment,'unknown');
      assert.deepEqual(
        [result.envelope.metrics.observed_gross_minor,result.envelope.metrics.observed_fee_minor,
         result.envelope.metrics.observed_net_minor,result.envelope.metrics.settled_orders,
         result.envelope.metrics.verified_bros_sell_orders,result.envelope.metrics.verified_cac_minor,
         result.envelope.metrics.causal_lift],
        [5000,170,4830,null,null,null,null]);
      for(const flag of ['authenticated','providerAttested','paymentEnvironmentVerified',
        'settlementVerified','entitlementVerified','attributionVerified','persisted'])
        assert.equal(result[flag],false,flag);
      const replay=project(reconcile({...order},{...charge},{...detail}),scope,'2026-10-27T04:21:00Z');
      assert.equal(result.envelope.providerRecordKey,replay.envelope.providerRecordKey);
      assert.throws(()=>project(candidate,{...scope,product:'content'},at),/Invalid unattested HitPay handoff/);
      assert.throws(()=>project({...candidate,entitlementVerified:true},scope,at),/Invalid unattested HitPay handoff/);
      assert.throws(()=>project({...candidate,settledOrders:1},scope,at),/Invalid unattested HitPay handoff/);
      assert.throws(()=>reconcile(order,{...charge,remark:'Order #wrong'},detail),
        /Invalid BROS DEMAND HitPay order-charge evidence/);
      const refund=reconcile({...order,payment_status:'partially_refunded'},charge,
        {...detail,refunded_amount:10});
      const changed=project(refund,scope,at);
      assert.equal(changed.sourceStatus,'REFUND_OBSERVED');
      assert.notEqual(changed.envelope.providerRecordKey,result.envelope.providerRecordKey);
      assert.equal(changed.envelope.metrics.settled_orders,null);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
