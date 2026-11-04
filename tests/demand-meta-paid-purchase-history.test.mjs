import test from "node:test";
import assert from "node:assert/strict";
import {reconcileDemandPaidPurchaseWithHistory as reconcile} from "../lib/demand/meta-paid-purchase-history.ts";
const now="2026-11-04T12:00:00.000Z";
const pair=()=>({order:{provider:"hitpay",orderId:"order_001",paymentStatus:"paid",amountMinor:10000,currency:"MYR",paidAt:"2026-11-04T11:00:00.000Z",referenceNumber:"ref_001"},purchase:{provider:"meta",pixelId:"1636131111400103",eventName:"Purchase",eventId:"event_001",valueMinor:10000,currency:"MYR",eventAt:"2026-11-04T11:01:00.000Z",orderReference:"ref_001",deduplicationVerified:true}});
const history=()=>({orderIds:[],eventIds:[],references:[]});
test("clean history is only an unattested preflight, never launch permission",()=>{
 const result=reconcile([pair()],now,history());
 assert.equal(result.status,"CANDIDATES_UNATTESTED");
 assert.equal(result.acceptedCount,1);
 assert.equal(result.launchAllowed,false);
 assert.equal(result.independentlyVerified,false);
 assert.ok(Object.isFrozen(result));
});
test("historic order, event and reference collisions fail closed",()=>{
 for(const key of ["orderIds","eventIds","references"]){
  const h=history(); h[key]=[key==="orderIds"?"order_001":key==="eventIds"?"event_001":"ref_001"];
  const result=reconcile([pair()],now,h);
  assert.equal(result.status,"REJECTED");
  assert.equal(result.reason,"HISTORICAL_ORDER_EVENT_OR_REFERENCE_COLLISION");
  assert.equal(result.acceptedCount,0);
 }
});
test("unreadable, incomplete, duplicated or oversized history is rejected",()=>{
 const revoked=Proxy.revocable(history(),{});revoked.revoke();
 for(const h of [null,{}, {orderIds:[],eventIds:[]}, {...history(),other:[]},
  {...history(),eventIds:["duplicate","duplicate"]},
  {...history(),references:[" ref_001"]},
  {...history(),orderIds:Array(10001).fill("x")},
  {...history(),eventIds:[,]},
  revoked.proxy]){
  const result=reconcile([pair()],now,h);
  assert.equal(result.status,"REJECTED");
  assert.equal(result.launchAllowed,false);
 }
});
test("bad candidate still fails despite clean historic ledger",()=>{
 const candidate=pair();candidate.purchase.valueMinor=5000;
 const result=reconcile([candidate],now,history());
 assert.equal(result.status,"REJECTED");
 assert.equal(result.acceptedCount,0);
});
