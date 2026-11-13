import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDemandPaidPurchaseCandidate as reconcile } from "../lib/demand/meta-paid-purchase-reconciliation.ts";
const now = "2026-11-04T12:00:00.000Z";
const order = { provider:"hitpay", orderId:"order_123", paymentStatus:"paid",
  amountMinor:10000, currency:"MYR", paidAt:"2026-11-04T11:00:00.000Z", referenceNumber:"ref_123" };
const purchase = { provider:"meta", pixelId:"1636131111400103", eventName:"Purchase",
  eventId:"event_123", valueMinor:10000, currency:"MYR",
  eventAt:"2026-11-04T11:01:00.000Z", orderReference:"ref_123", deduplicationVerified:true };
test("matched provider-shaped evidence is still not launch authority", () => {
  const r = reconcile(order,purchase,now);
  assert.equal(r.status,"MATCHED_UNATTESTED");
  assert.equal(r.independentlyVerified,false);
  assert.equal(r.launchAllowed,false);
  assert.equal(Object.isFrozen(r),true);
});
test("reject wrong payment, RM50, wrong pixel, missing reference, undeduplicated and stale", () => {
  for (const [o,p,t] of [
    [{...order,paymentStatus:"unpaid"},purchase,now],
    [{...order,amountMinor:5000},purchase,now],
    [order,{...purchase,valueMinor:5000},now],
    [order,{...purchase,pixelId:"wrong"},now],
    [order,{...purchase,orderReference:"other"},now],
    [order,{...purchase,deduplicationVerified:false},now],
    [{...order,paidAt:"2026-11-02T11:00:00.000Z"},purchase,now],
    [order,{...purchase,eventAt:"2026-11-06T11:00:00.000Z"},now],
    [order,{...purchase,eventAt:"2026-11-04T10:50:00.000Z"},now],
    [{...order,paidAt:"2026-11-04T11:59:00.000Z"},
      {...purchase,eventAt:"2026-11-03T12:00:00.000Z"},now],
    [order,purchase,"invalid"],
    [{...order,rawEmail:"private"},purchase,now],
    [order,{...purchase,claimedUtmVerified:true},now],
  ]) {
    const r = reconcile(o,p,t);
    assert.equal(r.status,"REJECTED");
    assert.equal(r.launchAllowed,false);
  }
});
test("accessor payloads never count as independent provider proof", () => {
  const evil={...order};Object.defineProperty(evil,"paidAt",{get(){throw Error("secret");},enumerable:true});
  assert.equal(reconcile(evil,purchase,now).status,"REJECTED");
});

test("standalone reconciliation fails closed for revoked or throwing provider proxies", () => {
  const revoked = Proxy.revocable({...order}, {});
  revoked.revoke();
  const throwing = new Proxy({...purchase}, {getPrototypeOf(){throw Error("provider read failed");}});
  for (const [o,p] of [[revoked.proxy,purchase],[order,throwing]]) {
    const result = reconcile(o,p,now);
    assert.equal(result.status,"REJECTED");
    assert.equal(result.reason,"UNREADABLE_PROVIDER_EVIDENCE");
    assert.equal(result.independentlyVerified,false);
    assert.equal(result.launchAllowed,false);
  }
});
