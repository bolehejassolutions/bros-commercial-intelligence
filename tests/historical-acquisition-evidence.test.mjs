import test from "node:test";
import assert from "node:assert/strict";
import { reviewDemandAcquisitionEvidencePair as review } from "../lib/demand/historical-acquisition-evidence.ts";

// Synthetic IDs and provider-shaped values, NOT a live merchant fixture.
const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  product: "demand", accountId: "act_1997776120879476",
  campaignId: "120250864977630697", currency: "MYR",
  since: "2026-10-09", until: "2026-10-09",
  collectedAt: "2026-10-28T04:12:00Z",
};
const meta = {
  campaign_id: scope.campaignId, date_start: scope.since, date_stop: scope.until,
  spend: "4.32", inline_link_clicks: "1",
  actions: [
    { action_type: "purchase", value: "1" },
    { action_type: "omni_purchase", value: "1" },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "1" },
    { action_type: "landing_page_view", value: "1" },
  ],
};
const order = {
  id: "22222222-2222-4222-8222-222222222222",
  order_display_number: 1007, amount: 5000, currency: "myr",
  status: "completed", payment_status: "paid", fulfilment_status: "completed",
};
const charge = {
  id: "33333333-3333-4333-8333-333333333333",
  amount: 5000, currency: "myr", status: "succeeded",
  remark: "Order #" + order.id,
};
const detail = {
  id: charge.id, amount: 50, amount_without_fees: 48.3,
  refunded_amount: 0, currency: "myr", status: "succeeded",
  remark: charge.remark, order_reference_number: "1007", payout: null,
};
const run = (m=meta, o=order, c=charge, d=detail, s=scope) => review(s,m,o,c,d);

test("one Meta purchase across aliases remains one attributed signal, never one joined sale", () => {
  const r = run();
  assert.equal(r.status, "UNATTESTED_PARALLEL_EVIDENCE");
  assert.equal(r.metaAttributedPurchaseEvents, 1);
  assert.equal(r.pixelPurchaseEvents, 1);
  assert.equal(r.hitpayPaymentObservation, "PROVIDER_REPORTED_PAID");
  assert.equal(r.nextAction, "OBTAIN_META_EVENT_TO_HITPAY_ORDER_LINK");
  assert.equal(r.hitpayGrossMinor, 5000);
  assert.equal(r.hitpayFeeMinor, 170);
  assert.equal(r.hitpayNetMinor, 4830);
  for (const key of [
    "providerAuthenticationVerified","tenantMembershipVerified",
    "paymentEnvironmentVerified","productVerified",
    "metaEventToOrderJoinVerified","acquisitionAttributionVerified",
    "payoutAllocationVerified","bankSettlementVerified",
    "entitlementVerified","actionExecutedVerified","outcomeVerified",
    "learningVerified","executionAllowed",
  ]) assert.equal(r[key], false, key);
  for (const key of [
    "verifiedBrosSellOrders","verifiedSettledOrders","verifiedCpaMinor",
    "verifiedCacMinor","verifiedConversionRate","causalLift",
  ]) assert.equal(r[key], null, key);
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.requiredIndependentEvidence), true);
});

test("replay is stable; changed provider observation creates a different pair", () => {
  const baseline = run();
  assert.equal(baseline.pairKey, run({...meta,actions:meta.actions.map(x=>({...x}))},
    {...order},{...charge},{...detail},{...scope}).pairKey);
  assert.match(baseline.pairKey,/^demand:acquisition-evidence-pair:sha256:[a-f0-9]{64}$/);
  const changed = run({...meta,spend:"4.33"});
  assert.notEqual(changed.pairKey,baseline.pairKey);
  const revisedFee = run(meta,order,charge,{...detail,amount_without_fees:48.2});
  assert.notEqual(revisedFee.pairKey,baseline.pairKey);
  assert.equal(revisedFee.hitpayOrderIdentityDigest,baseline.hitpayOrderIdentityDigest);
});

test("same amount, same date and a payout amount never prove payout allocation", () => {
  const r=run(meta,order,charge,{...detail,payout:{status:"paid",amount:48.3}});
  assert.equal(r.pairKey,run().pairKey);
  assert.equal(r.payoutAllocationVerified,false);
  assert.equal(r.bankSettlementVerified,false);
  assert.equal(r.verifiedSettledOrders,null);
});

test("omni-only Meta purchase is a signal, not a verified transaction", () => {
  const r=run({...meta,actions:[{action_type:"omni_purchase",value:"1"}]});
  assert.equal(r.nextAction,"OBTAIN_META_EVENT_TO_HITPAY_ORDER_LINK");
  assert.equal(r.metaEventToOrderJoinVerified,false);
  assert.equal(r.verifiedCacMinor,null);
});

test("conflicting Meta aliases take precedence over a matching amount", () => {
  const r=run({...meta,actions:[
    {action_type:"purchase",value:"1"},
    {action_type:"offsite_conversion.fb_pixel_purchase",value:"2"},
  ]});
  assert.equal(r.metaPurchaseAliasConflict,true);
  assert.equal(r.nextAction,"AUDIT_META_ACTION_ALIASES");
  assert.equal(r.verifiedBrosSellOrders,null);
});

test("absent purchase signals and refunds produce evidence requests, not zero sales", () => {
  assert.equal(run({...meta,actions:[]}).nextAction,"VERIFY_META_PURCHASE_EVENT_COVERAGE");
  const refundedOrder={...order,payment_status:"refunded"};
  const refundedCharge={...charge,status:"refunded"};
  const refundedDetail={...detail,status:"refunded",refunded_amount:50};
  const r=run(meta,refundedOrder,refundedCharge,refundedDetail);
  assert.equal(r.hitpayPaymentObservation,"REFUND_OBSERVED");
  assert.equal(r.nextAction,"VERIFY_HITPAY_PAYMENT_AND_REFUND_STATE");
  assert.equal(r.verifiedBrosSellOrders,null);
});

test("unlinked provider references fail closed and output excludes raw merchant IDs", () => {
  assert.throws(()=>run(meta,order,{...charge,remark:"Order #other"}));
  assert.throws(()=>run({...meta,campaign_id:"wrong"}));
  const json=JSON.stringify(run());
  assert.equal(json.includes(order.id),false);
  assert.equal(json.includes(charge.id),false);
  assert.equal(json.includes("customer_email"),false);
});
