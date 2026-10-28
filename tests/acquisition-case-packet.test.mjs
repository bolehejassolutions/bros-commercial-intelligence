import test from "node:test";
import assert from "node:assert/strict";
import { prepareDemandAcquisitionCasePacket as prepare } from "../lib/demand/acquisition-case-packet.ts";
import { reviewDemandAcquisitionEvidencePair } from "../lib/demand/historical-acquisition-evidence.ts";

// Synthetic provider-shaped fixtures only; no actual customer or merchant IDs.
const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  product: "demand", accountId: "act_1997776120879476",
  campaignId: "120250864977630697", currency: "MYR",
  since: "2026-10-09", until: "2026-10-09",
  collectedAt: "2026-10-28T04:12:00Z",
};
const meta = {
  campaign_id: scope.campaignId, date_start: scope.since,
  date_stop: scope.until, spend: "4.32", inline_link_clicks: "1",
  actions: [
    {action_type:"purchase",value:"1"},
    {action_type:"omni_purchase",value:"1"},
    {action_type:"offsite_conversion.fb_pixel_purchase",value:"1"},
    {action_type:"landing_page_view",value:"1"},
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
const evidence = reviewDemandAcquisitionEvidencePair(scope,meta,order,charge,detail);
const proposal = {
  tenantId: scope.tenantId, product: "demand", pilotProduct: "bros_sell",
  metaAccountId: scope.accountId, campaignId: scope.campaignId,
  hypothesis: "Clearer product explanation may improve qualified acquisition.",
  action: "LANDING_PAGE_TEST", primaryKpi: "verified_paid_orders",
  baselineStart: scope.since, baselineEnd: scope.until,
  experimentStart: "2026-11-01", experimentEnd: "2026-11-07",
  preRegisteredAt: "2026-10-28T04:20:00Z",
  evidenceCandidateIds: [evidence.pairKey],
  maxIncrementalSpendMinor: 0,
};
const run=(s=scope,m=meta,p=proposal)=>
  prepare(s,m,order,charge,detail,p);

test("creates deterministic evidence-linked diagnosis and non-executable proposed action",()=>{
  const a=run(), b=run({...scope},{...meta,actions:meta.actions.map(x=>({...x}))},{...proposal,evidenceCandidateIds:[...proposal.evidenceCandidateIds]});
  assert.deepEqual(a,b);
  assert.match(a.caseId,/^demand:acquisition-case:sha256:[a-f0-9]{64}$/);
  assert.equal(a.stage,"DIAGNOSIS_AND_ACTION_PROPOSAL_ONLY");
  assert.equal(a.status,"UNATTESTED_NOT_AUTHORIZED");
  assert.equal(a.diagnosisCode,"OBTAIN_META_EVENT_TO_HITPAY_ORDER_LINK");
  assert.equal(a.proposedAction,"LANDING_PAGE_TEST");
  assert.equal(a.primaryKpi,"verified_paid_orders");
  assert.deepEqual(a.sourceEvidenceCandidateIds,[
    evidence.metaSnapshotKey,evidence.hitpayCandidateKey,evidence.pairKey,
  ]);
  assert.equal(Object.isFrozen(a),true);
  assert.equal(Object.isFrozen(a.sourceEvidenceCandidateIds),true);
});

test("all authority, spend, CPA, conversion, causal and learning gates fail closed",()=>{
  const a=run();
  for(const k of [
    "ownerApprovalVerified","providerAuthenticationVerified",
    "tenantAuthorizationVerified","metaEventToOrderJoinVerified",
    "hitpaySettlementVerified","entitlementVerified","actionExecutedVerified",
    "outcomeVerified","learningVerified","controlledExperimentVerified",
    "causalInferenceEligible","executionAllowed",
  ]) assert.equal(a[k],false,k);
  for(const k of [
    "verifiedPaidOrders","verifiedSettledOrders","verifiedCpaMinor",
    "verifiedCacMinor","verifiedConversionRate","verifiedPrimaryKpi",
    "causalLift","verifiedOutcome","recordedLearning",
  ]) assert.equal(a[k],null,k);
  assert.equal(a.maxIncrementalSpendMinor,0);
  assert.equal(a.noPricingChanges,true);
  assert.equal(a.noPublisherChanges,true);
});

test("rejects tenant, Meta account, campaign, baseline and evidence mismatches",()=>{
  const variants=[
    {tenantId:"44444444-4444-4444-8444-444444444444"},
    {metaAccountId:"act_999999999999999"},
    {campaignId:"999999999999999"},
    {baselineStart:"2026-10-08"},
    {baselineEnd:"2026-10-10"},
    {evidenceCandidateIds:["demand:acquisition-evidence-pair:sha256:"+"0".repeat(64)]},
  ];
  for(const change of variants)
    assert.throws(()=>run(scope,meta,{...proposal,...change}),/Invalid BROS DEMAND acquisition case linkage/);
});

test("revised provider observation requires revised preregistration evidence identity",()=>{
  const revisedMeta={...meta,spend:"4.33"};
  assert.throws(()=>run(scope,revisedMeta,proposal),/Invalid BROS DEMAND acquisition case linkage/);
  const revisedPair=reviewDemandAcquisitionEvidencePair(scope,revisedMeta,order,charge,detail);
  const updated=run(scope,revisedMeta,{...proposal,evidenceCandidateIds:[revisedPair.pairKey]});
  assert.notEqual(updated.caseId,run().caseId);
  assert.equal(updated.verifiedOutcome,null);
});

test("conflicting Meta action aliases are diagnosed, not silently counted as paid sales",()=>{
  const conflicting={...meta,actions:[
    {action_type:"purchase",value:"1"},
    {action_type:"offsite_conversion.fb_pixel_purchase",value:"2"},
  ]};
  const pair=reviewDemandAcquisitionEvidencePair(scope,conflicting,order,charge,detail);
  const a=run(scope,conflicting,{...proposal,evidenceCandidateIds:[pair.pairKey]});
  assert.equal(a.diagnosisCode,"AUDIT_META_ACTION_ALIASES");
  assert.equal(a.metaPurchaseAliasConflict,true);
  assert.equal(a.verifiedPaidOrders,null);
  assert.equal(a.causalLift,null);
});

test("candidate packet contains no raw order/charge IDs, buyer details or approval tokens",()=>{
  const serialized=JSON.stringify(run());
  assert.equal(serialized.includes(order.id),false);
  assert.equal(serialized.includes(charge.id),false);
  assert.equal(serialized.includes("customer_email"),false);
  assert.equal(serialized.includes("approvalToken"),false);
});


test("rejects evidence collected after claimed preregistration, even for an old baseline",()=>{
  assert.throws(()=>run(scope,meta,{...proposal,
    preRegisteredAt:"2026-10-28T04:00:00Z",
  }),/Invalid BROS DEMAND acquisition case chronology/);
  // Equal timestamps are structurally possible, but never provider attestation.
  const equal=run(scope,meta,{...proposal,
    preRegisteredAt:scope.collectedAt,
  });
  assert.equal(equal.providerAuthenticationVerified,false);
  assert.equal(equal.executionAllowed,false);
});

test("rejects incomplete MYT calendar baseline even when UTC collection date differs",()=>{
  const currentScope={...scope,
    since:"2026-10-28",until:"2026-10-28",
    collectedAt:"2026-10-27T17:00:00Z", // 01:00 MYT on 28 Oct
  };
  const currentMeta={...meta,
    date_start:currentScope.since,date_stop:currentScope.until,
  };
  const currentPair=reviewDemandAcquisitionEvidencePair(
    currentScope,currentMeta,order,charge,detail,
  );
  const currentProposal={...proposal,
    baselineStart:currentScope.since,baselineEnd:currentScope.until,
    evidenceCandidateIds:[currentPair.pairKey],
  };
  assert.throws(()=>run(currentScope,currentMeta,currentProposal),
    /Invalid BROS DEMAND acquisition case chronology/);
  assert.equal(run().verifiedOutcome,null);
});

// DEMAND_CASE_FUTURE_ATTESTATION_GUARD_20261028
test("future-dated collection or preregistration cannot masquerade as a present acquisition case",()=>{
  // The pure Meta normalizer still supports future synthetic scenario replay.
  // A decision packet must not cite observations not yet collected.
  const futureScope={...scope,collectedAt:"2099-01-02T01:00:00Z"};
  const futurePair=reviewDemandAcquisitionEvidencePair(
    futureScope,meta,order,charge,detail);
  const futureProposal={...proposal,
    preRegisteredAt:"2099-01-03T01:00:00Z",
    experimentStart:"2100-01-01",experimentEnd:"2100-01-07",
    evidenceCandidateIds:[futurePair.pairKey]};
  assert.throws(()=>run(futureScope,meta,futureProposal),
    /Invalid BROS DEMAND acquisition case chronology/);
  // Even real historical evidence cannot be cited by a fabricated future
  // preregistration as if a decision had already occurred.
  assert.throws(()=>run(scope,meta,{...proposal,
    preRegisteredAt:"2099-01-03T01:00:00Z",
    experimentStart:"2100-01-01",experimentEnd:"2100-01-07"}),
    /Invalid BROS DEMAND acquisition case chronology/);
  assert.equal(run().outcomeVerified,false);
  assert.equal(run().verifiedCpaMinor,null);
});
