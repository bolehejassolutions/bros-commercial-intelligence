import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDemandHitPayOrderCharge as reconcile } from '../lib/demand/hitpay-order-charge.ts';
// Synthetic IDs; amounts/statuses model provider response shapes, not live fixtures.
const order={id:'11111111-1111-4111-8111-111111111111',order_display_number:1007,
  amount:5000,currency:'myr',status:'completed',payment_status:'paid',fulfilment_status:'completed'};
const charge={id:'22222222-2222-4222-8222-222222222222',amount:5000,
  currency:'myr',status:'succeeded',remark:'Order #'+order.id};
const detail={id:charge.id,amount:50,amount_without_fees:48.3,refunded_amount:0,
  currency:'myr',status:'succeeded',remark:charge.remark,order_reference_number:'1007',payout:null};
const invalid=/Invalid BROS DEMAND HitPay order-charge evidence/;
test('explicit order-charge reference permits paid observation, not settlement/entitlement/attribution',()=>{
  const x=reconcile(order,charge,detail);
  assert.equal(x.status,'PROVIDER_REPORTED_PAID');
  assert.equal(x.grossMinor,5000);assert.equal(x.feeMinor,170);assert.equal(x.netMinor,4830);
  assert.equal(x.providerOrderChargeLinkMatched,true);
  for(const k of ['providerAuthenticationVerified','tenantMembershipVerified','paymentEnvironmentVerified',
    'productVerified','payoutAllocationVerified','bankSettlementVerified','entitlementVerified',
    'acquisitionAttributionVerified']) assert.equal(x[k],false,k);
  for(const k of ['verifiedBrosSellOrders','settledOrders','verifiedCacMinor','causalLift'])
    assert.equal(x[k],null,k);
  assert.equal(Object.isFrozen(x),true);
  assert.match(x.candidateKey,/^demand:hitpay-candidate:sha256:[a-f0-9]{64}$/);
});
test('same observation is idempotent, status/fee/refund revisions change candidate identity',()=>{
  const x=reconcile(order,charge,detail);
  assert.equal(x.candidateKey,reconcile({...order},{...charge},{...detail}).candidateKey);
  const feeRevision=reconcile(order,charge,{...detail,amount_without_fees:48.2});
  const refundRevision=reconcile({...order,payment_status:'partially_refunded'},charge,
    {...detail,refunded_amount:10});
  assert.notEqual(x.candidateKey,feeRevision.candidateKey);
  assert.match(x.orderIdentityDigest,/^[a-f0-9]{64}$/);
  assert.equal(x.orderIdentityDigest,feeRevision.orderIdentityDigest);
  assert.equal(x.orderIdentityDigest,refundRevision.orderIdentityDigest);
  assert.notEqual(x.candidateKey,refundRevision.candidateKey);
  assert.equal(refundRevision.status,'REFUND_OBSERVED');
  assert.equal(refundRevision.settledOrders,null);
});
test('payout amount or object cannot self-prove order allocation or bank settlement',()=>{
  const x=reconcile(order,charge,{...detail,payout:{id:'some-payout',status:'paid',amount:48.3}});
  assert.equal(x.payoutAllocationVerified,false);
  assert.equal(x.bankSettlementVerified,false);
  assert.equal(x.settledOrders,null);
  assert.equal(x.candidateKey,reconcile(order,charge,detail).candidateKey);
});
test('reject amount coincidence without exact order ID and display number linkage',()=>{
  for(const [o,c,d] of [
    [order,{...charge,remark:'Order #33333333-3333-4333-8333-333333333333'},detail],
    [order,charge,{...detail,order_reference_number:'1008'}],
    [order,charge,{...detail,remark:'Order #another'}],
    [order,{...charge,amount:4900},detail],
    [order,charge,{...detail,amount:49}],
    [order,charge,{...detail,id:'44444444-4444-4444-8444-444444444444'}],
    [order,charge,{...detail,status:'failed'}],
  ]) assert.throws(()=>reconcile(o,c,d),invalid);
});
test('reject impossible monetary evidence, invalid statuses and currency',()=>{
  for(const patch of [{amount_without_fees:50.01},{amount_without_fees:-1},
    {refunded_amount:50.01},{amount:50.001},{refunded_amount:0.001}])
    assert.throws(()=>reconcile(order,charge,{...detail,...patch}),invalid);
  assert.throws(()=>reconcile({...order,currency:'sgd'},charge,detail),invalid);
  assert.throws(()=>reconcile({...order,order_display_number:0},charge,detail),invalid);
  assert.throws(()=>reconcile({...order,payment_status:'untrusted'},charge,detail),invalid);
});
test('paid status alone is not a completed order and cannot produce a verified sale',()=>{
  const x=reconcile({...order,status:'draft'},charge,detail);
  assert.equal(x.status,'NOT_PAID');
  assert.equal(x.verifiedBrosSellOrders,null);
  assert.equal(x.acquisitionAttributionVerified,false);
});

test('coercible provider IDs cannot masquerade as order/charge identities',()=>{
  const baseline=reconcile(order,charge,detail);
  // RegExp.test(array) previously accepted a single UUID string inside an
  // array, then order.id.toLowerCase() raised an unmasked TypeError.
  assert.throws(()=>reconcile({...order,id:[order.id]},charge,{
    ...detail,remark:'Order #'+order.id}),invalid);
  const arrayChargeId=[charge.id];
  assert.throws(()=>reconcile(order,{...charge,id:arrayChargeId},{
    ...detail,id:arrayChargeId}),invalid);
  assert.throws(()=>reconcile(order,charge,{...detail,id:[charge.id]}),invalid);
  // Never invoke a hostile object's custom toString during identity checks.
  const hostile={toString(){throw new Error('provider-object-executed');}};
  for(const [o,c,d] of [
    [{...order,id:hostile},charge,detail],
    [order,{...charge,id:hostile},detail],
    [order,charge,{...detail,id:hostile}],
  ]) assert.throws(()=>reconcile(o,c,d),invalid);
  assert.equal(reconcile({...order},{...charge},{...detail}).candidateKey,baseline.candidateKey);
  assert.equal(baseline.verifiedBrosSellOrders,null);
  assert.equal(baseline.bankSettlementVerified,false);
  assert.equal(baseline.acquisitionAttributionVerified,false);
});

test('sub-cent HitPay major-unit values fail closed instead of silently rounding fees or refunds',()=>{
  for(const patch of [
    {amount_without_fees:48.30000000001},
    {refunded_amount:0.000000001},
    {amount:50.0000000001},
  ]) assert.throws(()=>reconcile(order,charge,{...detail,...patch}),invalid);
  const exact=reconcile({...order},{...charge},{...detail,refunded_amount:0.29});
  assert.equal(exact.refundedMinor,29);
  assert.equal(exact.status,'REFUND_OBSERVED');
  assert.equal(exact.settledOrders,null);
});
