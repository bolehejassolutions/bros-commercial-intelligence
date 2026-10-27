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
  bci:'cdde7b2810273fd713dca23cfd12dab12f80fd4d',
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
  test('revised HitPay identity stays one untrusted order; repaired BCI handoff accepts stable identity without attestation',async()=>{
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

      // Current BCI accepts the identity-aware DEMAND contract but never
      // promotes a provider observation into authenticated paid evidence.
      const scope={tenantId,product:'demand'};
      const observedAt='2026-10-27T12:20:00Z';
      const mappedFirst=project(first,scope,observedAt);
      const mappedRevised=project(revised,scope,observedAt);
      assert.equal(mappedFirst.sourceOrderIdentityDigest,first.orderIdentityDigest);
      assert.equal(mappedRevised.sourceOrderIdentityDigest,first.orderIdentityDigest);
      assert.equal(mappedFirst.envelope.provider,'other');
      assert.equal(mappedFirst.sourceProvider,'hitpay');
      assert.notEqual(mappedFirst.envelope.providerRecordKey,
        mappedRevised.envelope.providerRecordKey);
      for(const mapped of [mappedFirst,mappedRevised]){
        assert.equal(mapped.envelope.environment,'unknown');
        assert.equal(mapped.envelope.provenance,'synthetic');
        assert.equal(mapped.envelope.metrics.settled_orders,null);
        assert.equal(mapped.envelope.metrics.verified_cac_minor,null);
        for(const key of ['authenticated','providerAttested',
          'paymentEnvironmentVerified','settlementVerified',
          'entitlementVerified','attributionVerified','persisted'])
          assert.equal(mapped[key],false,key);
      }
      assert.throws(()=>project({...first,orderIdentityDigest:'0'.repeat(64)},
        scope,observedAt),/Invalid unattested HitPay handoff/);
      assert.throws(()=>project(first,{tenantId,product:'content'},observedAt),
        /Invalid unattested HitPay handoff/);
      assert.throws(()=>project({...first,settledOrders:1},scope,observedAt),
        /Invalid unattested HitPay handoff/);
      assert.throws(()=>project({...first,providerAuthenticationVerified:true},
        scope,observedAt),/Invalid unattested HitPay handoff/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
