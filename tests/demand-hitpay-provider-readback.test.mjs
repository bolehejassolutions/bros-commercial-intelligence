import test from "node:test";
import assert from "node:assert/strict";
import { reviewDemandHitPayProviderReadback as review } from "../lib/demand/hitpay-provider-readback.ts";

// PII-free provider response SHAPES, with monetary values and status observed
// from the real #1007 HitPay readback on 29 Oct 2026 MYT. UUIDs are fabricated.
// This replay is NOT an authenticated DEMAND application integration.
const orderId="11111111-1111-4111-8111-111111111111";
const chargeId="22222222-2222-4222-8222-222222222222";
const orders={data:[{id:orderId,order_display_number:1007,amount:5000,currency:"myr",
  status:"completed",payment_status:"paid",fulfilment_status:"completed"}],
  has_more:false,next_cursor:null};
const charges={data:[{id:chargeId,amount:5000,currency:"myr",status:"succeeded",
  remark:"Order #"+orderId}],has_more:false,next_cursor:null};
const detail={id:chargeId,amount:50,amount_without_fees:48.3,refunded_amount:0,
  currency:"myr",status:"succeeded",remark:"Order #"+orderId,
  order_reference_number:"1007",payout:null};
const refunds={transaction_id:chargeId,charge_status:"succeeded",
  charge_amount:50,currency:"myr",total_refunded:0,refunds:[]};
const run=(o=orders,c=charges,d=detail,r=refunds)=>review(o,c,d,r);

test("provider-observed order/charge/refund values reconcile without inventing attribution",()=>{
  const result=run();
  assert.equal(result.orderDisplayNumber,1007);
  assert.equal(result.observation,"PROVIDER_REPORTED_PAID");
  assert.equal(result.refundObservation,"NO_REFUNDS_REPORTED_AT_READBACK");
  assert.equal(result.chargePayoutFieldState,"NULL_UNLINKED");
  assert.equal(result.grossMinor,5000);
  assert.equal(result.feeMinor,170);
  assert.equal(result.netAfterFeesMinor,4830);
  assert.equal(result.refundedMinor,0);
  assert.equal(result.providerOrderChargeReferenceConsistent,true);
  assert.equal(result.payoutAllocationVerified,false);
  assert.equal(result.bankSettlementVerified,false);
  assert.equal(result.entitlementVerified,false);
  assert.equal(result.metaEventToOrderJoinVerified,false);
  assert.equal(result.verifiedAcquisitionOutcome,null);
  assert.equal(result.verifiedSettledOrders,null);
  assert.equal(result.verifiedCpaMinor,null);
  assert.equal(result.causalLift,null);
  assert.equal(run(structuredClone(orders),structuredClone(charges),
    structuredClone(detail),structuredClone(refunds)).snapshotKey,result.snapshotKey);
  assert.equal(JSON.stringify(result).includes(orderId),false);
  assert.equal(JSON.stringify(result).includes(chargeId),false);
});

test("reject mismatched charge/refund identity or monetary contradiction",()=>{
  assert.throws(()=>run(orders,charges,detail,{...refunds,transaction_id:orderId}));
  assert.throws(()=>run(orders,charges,detail,{...refunds,total_refunded:0.01}));
  assert.throws(()=>run(orders,charges,detail,{...refunds,charge_amount:49}));
  assert.throws(()=>run(orders,charges,detail,{...refunds,refunds:[{}]}));
  assert.throws(()=>run(orders,charges,{...detail,amount_without_fees:50.001}));
  assert.throws(()=>run(orders,charges,{...detail,remark:"Order #other"}));
});

test("reject incomplete provider pages and duplicate candidates",()=>{
  assert.throws(()=>run({...orders,has_more:true}));
  assert.throws(()=>run({...orders,next_cursor:"more"}));
  assert.throws(()=>run({...orders,data:[]}));
  assert.throws(()=>run(orders,{...charges,data:[...charges.data,...charges.data]}));
  assert.throws(()=>run(orders,{...charges,next_cursor:"more"}));
});

test("refund revisions remain review-only and alter snapshot identity",()=>{
  const changedOrders={...orders,data:[{...orders.data[0],payment_status:"partially_refunded"}]};
  const changedDetail={...detail,refunded_amount:10};
  const changedRefunds={...refunds,total_refunded:10,refunds:[{status:"succeeded"}]};
  const result=run(changedOrders,charges,changedDetail,changedRefunds);
  assert.equal(result.observation,"REFUND_OBSERVED");
  assert.equal(result.refundObservation,"REFUND_REVIEW_REQUIRED");
  assert.equal(result.refundedMinor,1000);
  assert.notEqual(result.snapshotKey,run().snapshotKey);
  assert.equal(result.verifiedSettledOrders,null);
  assert.equal(result.verifiedCpaMinor,null);
});

// Provider-backed shape: the real historical #1007 charge detail returned
// payout:null while an independent paid payout matched its net amount.
// No amount coincidence or opaque non-null payout field proves allocation.
test("payout field presence changes evidence identity without implying settlement",()=>{
  const absent=run(orders,charges,(({payout,...rest})=>rest)(detail));
  const nullValue=run();
  const opaque=run(orders,charges,{...detail,payout:{id:"private-provider-reference"}});
  assert.equal(absent.chargePayoutFieldState,"NOT_RETURNED");
  assert.equal(nullValue.chargePayoutFieldState,"NULL_UNLINKED");
  assert.equal(opaque.chargePayoutFieldState,"PRESENT_UNVERIFIED");
  assert.equal(new Set([absent.snapshotKey,nullValue.snapshotKey,opaque.snapshotKey]).size,3);
  for (const result of [absent,nullValue,opaque]) {
    assert.equal(result.payoutAllocationVerified,false);
    assert.equal(result.bankSettlementVerified,false);
    assert.equal(result.verifiedSettledOrders,null);
    assert.equal(result.verifiedAcquisitionOutcome,null);
    assert.equal(result.verifiedCpaMinor,null);
    assert.equal(JSON.stringify(result).includes("private-provider-reference"),false);
  }
});

test("refund lifecycle revisions cannot collide at identical refund totals and counts",()=>{
  const o={...orders,data:[{...orders.data[0],payment_status:"partially_refunded"}]};
  const d={...detail,refunded_amount:10};
  const base={...refunds,total_refunded:10};
  const pending=run(o,charges,d,{...base,refunds:[
    {id:"refund-identity-0001",status:"pending",amount_refunded:10},
  ]});
  const succeeded=run(o,charges,d,{...base,refunds:[
    {id:"refund-identity-0001",status:"succeeded",amount_refunded:10},
  ]});
  const replaced=run(o,charges,d,{...base,refunds:[
    {id:"refund-identity-0002",status:"succeeded",amount_refunded:10},
  ]});
  assert.equal(new Set([pending.snapshotKey,succeeded.snapshotKey,replaced.snapshotKey]).size,3);
  for(const result of [pending,succeeded,replaced]){
    assert.equal(result.refundObservation,"REFUND_REVIEW_REQUIRED");
    assert.equal(result.verifiedSettledOrders,null);
    assert.equal(result.verifiedAcquisitionOutcome,null);
    assert.equal(result.durableBciLearningVerified,false);
    assert.equal(JSON.stringify(result).includes("refund-identity-000"),false);
  }
});

test("refund row ordering is stable, malformed lifecycle details fail closed",()=>{
  const o={...orders,data:[{...orders.data[0],payment_status:"partially_refunded"}]};
  const d={...detail,refunded_amount:10};
  const base={...refunds,total_refunded:10};
  const a={id:"refund-identity-0001",status:"succeeded",amount_refunded:10};
  const b={id:"refund-identity-0002",status:"pending"};
  const first=run(o,charges,d,{...base,refunds:[a,b]});
  const reversed=run(o,charges,d,{...base,refunds:[b,a]});
  assert.equal(first.snapshotKey,reversed.snapshotKey);
  for(const row of [{}, {status:""}, {status:4},
    {status:"succeeded",amount_refunded:-1},
    {status:"succeeded",amount_refunded:50.001},
    {status:"succeeded",id:22}]){
    assert.throws(()=>run(o,charges,d,{...base,refunds:[row]}));
  }
  assert.throws(()=>run(o,charges,d,{...base,refunds:Array(101).fill(a)}));
});
