import test from "node:test";
import assert from "node:assert/strict";
import {reconcileDemandPaidPurchaseBatch as reconcile} from "../lib/demand/meta-paid-purchase-batch.ts";
const now = "2026-11-04T12:00:00.000Z";
const pair = (suffix) => ({
  order: {provider:"hitpay",orderId:"order_"+suffix,paymentStatus:"paid",
    amountMinor:10000,currency:"MYR",paidAt:"2026-11-04T11:00:00.000Z",
    referenceNumber:"ref_"+suffix},
  purchase: {provider:"meta",pixelId:"1636131111400103",eventName:"Purchase",
    eventId:"event_"+suffix,valueMinor:10000,currency:"MYR",
    eventAt:"2026-11-04T11:01:00.000Z",orderReference:"ref_"+suffix,
    deduplicationVerified:true}
});
test("distinct candidates remain unattested and never authorize launch",()=>{
  const r=reconcile([pair("001"),pair("002")],now);
  assert.equal(r.status,"CANDIDATES_UNATTESTED");
  assert.equal(r.acceptedCount,2);
  assert.equal(r.independentlyVerified,false);
  assert.equal(r.launchAllowed,false);
  assert.ok(Object.isFrozen(r));
});
test("reused event ID, order ID, or reference reject entire batch",()=>{
  const base=pair("001");
  for(const duplicate of [
    {...pair("002"),purchase:{...pair("002").purchase,eventId:base.purchase.eventId}},
    {...pair("002"),order:{...pair("002").order,orderId:base.order.orderId}},
    {...pair("002"),order:{...pair("002").order,referenceNumber:base.order.referenceNumber},
      purchase:{...pair("002").purchase,orderReference:base.order.referenceNumber}},
  ]){
    const r=reconcile([base,duplicate],now);
    assert.equal(r.status,"REJECTED");
    assert.equal(r.reason,"DUPLICATE_ORDER_EVENT_OR_REFERENCE");
    assert.equal(r.acceptedCount,0);
    assert.equal(r.launchAllowed,false);
  }
});
test("malformed or invalid evidence fails closed",()=>{
  for(const input of [[],Array.from({length:101},(_,i)=>pair(String(i).padStart(3,"0"))),
    [{...pair("001"),extra:true}],[{order:pair("001").order}],
    [{...pair("001"),purchase:{...pair("001").purchase,valueMinor:5000}}],
    [{...pair("001"),get purchase(){throw Error("accessor executed")}}],
  ]){
    const r=reconcile(input,now);
    assert.equal(r.status,"REJECTED");
    assert.equal(r.launchAllowed,false);
  }
});
