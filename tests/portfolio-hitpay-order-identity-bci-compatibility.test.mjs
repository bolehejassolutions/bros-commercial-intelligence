/**
 * PORTFOLIO_HITPAY_IDENTITY_BCI_CONTRACT_GAP_20261027_2027
 * Coordinator-owned cross-branch acceptance evidence. SYNTHETIC ONLY.
 * Pin real worker source revisions; never infer settlement, attribution,
 * experiment execution, verified outcome, durable learning or BCI readiness.
 * No provider calls, credentials, DB mutations or publisher changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const pins=Object.freeze({
  demand:'8ea48f08b5057a46fb5107d98cfbc83a8ea80ffd',
  bci:'128f0605e1598ff07328da47ac734b7a68b67610',
});
const sources=[
  [pins.demand,'lib/demand/hitpay-order-charge.ts'],
  [pins.demand,'lib/demand/concurrent-control-protocol.ts'],
  [pins.demand,'lib/demand/concurrent-exposure-audit.ts'],
  [pins.demand,'lib/demand/concurrent-order-candidate-audit.ts'],
  [pins.bci,'lib/bci/unattested-hitpay-handoff.ts'],
  [pins.bci,'lib/bci/evidence-envelope.ts'],
];
const tenantId='33333333-3333-4333-8333-333333333333';

if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('pinned worker-source integration executes only in GitHub Actions');
}else{
  test('revised HitPay identity stays one untrusted order; current BCI handoff incompatibility is explicit',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-portfolio-hitpay-identity-'));
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
        const dest=join(dir,path);
        mkdirSync(dirname(dest),{recursive:true});
        writeFileSync(dest,src,{mode:0o600});
      }
      const load=async path=>import(pathToFileURL(join(dir,path)).href);
      const {reconcileDemandHitPayOrderCharge:reconcile}=await load(sources[0][1]);
      const {proposeDemandConcurrentControl:propose}=await load(sources[1][1]);
      const {auditDemandOrderExposureCandidates:audit}=await load(sources[3][1]);
      const {projectUnattestedDemandHitPayHandoff:project}=await load(sources[4][1]);

      const order={id:'11111111-1111-4111-8111-111111111111',
        order_display_number:1007,amount:5000,currency:'myr',
        status:'completed',payment_status:'paid',fulfilment_status:'completed'};
      const charge={id:'22222222-2222-4222-8222-222222222222',
        amount:5000,currency:'myr',status:'succeeded',
        remark:'Order #'+order.id};
      const detail={id:charge.id,amount:50,amount_without_fees:48.3,
        refunded_amount:0,currency:'myr',status:'succeeded',
        remark:charge.remark,order_reference_number:'1007',payout:null};
      const first=reconcile(order,charge,detail);
      const revised=reconcile(order,charge,{...detail,amount_without_fees:47.3});
      assert.equal(first.status,'PROVIDER_REPORTED_PAID');
      assert.equal(revised.status,'PROVIDER_REPORTED_PAID');
      assert.equal(first.orderIdentityDigest,revised.orderIdentityDigest);
      assert.notEqual(first.candidateKey,revised.candidateKey);
      assert.equal(first.verifiedBrosSellOrders,null);
      assert.equal(revised.settledOrders,null);

      const proposal=propose({tenantId,product:'demand',pilotProduct:'bros_sell',
        metaAccountId:'act_123456789',campaignId:'123456789',
        hypothesis:'Synthetic holdout for offer clarity, not a live experiment.',
        action:'LANDING_PAGE_TEST',
        treatmentChange:'Synthetic alternative offer copy, never published.',
        primaryKpi:'verified_paid_orders',plannedStart:'2026-10-29',
        plannedEnd:'2026-11-04',preRegisteredAt:'2026-10-27T07:00:00Z',
        evidenceCandidateIds:['meta_ads:sha256:'+'a'.repeat(64)],
        assignmentUnit:'CONSENTED_LANDING_VISITOR',
        assignmentMethod:'STICKY_RANDOM_50_50_PROPOSED',
        controlExperience:'UNCHANGED_EXISTING_LANDING_PAGE',
        analysisPolicy:'INTENTION_TO_TREAT',maxIncrementalSpendMinor:0});
      const visitor='a'.repeat(64);
      const event=(eventId,kind)=>({eventId,
        experimentCandidateId:proposal.candidateId,tenantId,product:'demand',
        visitorDigest:visitor,kind,arm:'control',
        observedAt:'2026-10-29T04:00:00Z',consentRecorded:true});
      const exposure=[event('assign:control','assignment'),
        event('expose:control','exposure')];
      const candidate=(eventId,record)=>({eventId,
        experimentCandidateId:proposal.candidateId,tenantId,
        product:'demand',pilotProduct:'bros_sell',visitorDigest:visitor,
        arm:'control',orderCandidateKey:record.candidateKey,
        orderIdentityDigest:record.orderIdentityDigest,
        observedAt:'2026-10-29T06:00:00Z'});
      const records=[candidate('checkout:first',first),
        candidate('checkout:revised',revised)];
      const auditResult=audit(proposal,exposure,records);
      const replay=audit(proposal,[...exposure].reverse(),[...records].reverse());
      assert.equal(auditResult.candidateId,replay.candidateId);
      assert.equal(auditResult.orderIdentityCoverageComplete,true);
      assert.equal(auditResult.uniqueOrderIdentityCandidates,1);
      assert.equal(auditResult.controlOrderCandidates,2);
      assert.equal(auditResult.structuralConsistency,false);
      assert.ok(auditResult.findings.includes('SAME_ORDER_REVISED_SNAPSHOT_REVIEW_REQUIRED'));
      for(const key of ['verifiedPaidOrders','settledOrders',
        'verifiedConversionRate','verifiedCacMinor','causalLift'])
        assert.equal(auditResult[key],null,key);
      for(const key of ['outcomeVerified','learningVerified',
        'attributionVerified','hitpaySettlementVerified','executionAllowed'])
        assert.equal(auditResult[key],false,key);

      // The NEW DEMAND record adds orderIdentityDigest, but BCI's exact
      // strict allowlist has not yet adopted that field. This is a genuine
      // cross-worker compatibility gap, not a payment/provider failure.
      const scope={tenantId,product:'demand'};
      const observedAt='2026-10-27T12:20:00Z';
      assert.throws(()=>project(first,scope,observedAt),
        /Invalid unattested HitPay handoff/);
      assert.throws(()=>project(revised,scope,observedAt),
        /Invalid unattested HitPay handoff/);

      // Legacy-shaped projection demonstrates the narrow schema mismatch,
      // NOT a recommended production workaround: it drops stable identity.
      const {orderIdentityDigest:ignored,...legacy}=first;
      assert.equal(ignored,first.orderIdentityDigest);
      const old=project(legacy,scope,observedAt);
      assert.equal(old.envelope.environment,'unknown');
      assert.equal(old.envelope.provenance,'synthetic');
      assert.equal(old.envelope.metrics.settled_orders,null);
      assert.equal(old.envelope.metrics.verified_cac_minor,null);
      assert.equal(old.authenticated,false);
      assert.equal(old.persisted,false);
      assert.throws(()=>project(legacy,{tenantId,product:'content'},observedAt),
        /Invalid unattested HitPay handoff/);
      assert.throws(()=>project({...legacy,settledOrders:1},scope,observedAt),
        /Invalid unattested HitPay handoff/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
