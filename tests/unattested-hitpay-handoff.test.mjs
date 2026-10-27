import test from "node:test";
import assert from "node:assert/strict";
import {projectUnattestedDemandHitPayHandoff as projectHandoff}
  from "../lib/bci/unattested-hitpay-handoff.ts";

const scope={tenantId:"11111111-1111-4111-8111-111111111111",product:"demand"};
const observedAt="2026-10-27T02:00:00Z";
const candidate={
  candidateKey:"demand:hitpay-candidate:sha256:"+"a".repeat(64),
  status:"PROVIDER_REPORTED_PAID",
  orderId:"22222222-2222-4222-8222-222222222222",
  chargeId:"33333333-3333-4333-8333-333333333333",
  grossMinor:5000,feeMinor:170,netMinor:4830,refundedMinor:0,
  orderPaymentStatus:"paid",orderFulfilmentStatus:"completed",
  providerOrderChargeLinkMatched:true,
  providerAuthenticationVerified:false,tenantMembershipVerified:false,
  paymentEnvironmentVerified:false,productVerified:false,
  payoutAllocationVerified:false,bankSettlementVerified:false,
  entitlementVerified:false,acquisitionAttributionVerified:false,
  verifiedBrosSellOrders:null,settledOrders:null,verifiedCacMinor:null,causalLift:null,
};
const project=(v=candidate,s=scope,time=observedAt)=>projectHandoff(v,s,time);

test("HitPay maps to constrained Neon provider without verified conversion",()=>{
  const result=project();
  assert.equal(result.envelope.provider,"other");
  assert.match(result.envelope.providerRecordKey,/^hitpay:order_charge:sha256:[a-f0-9]{64}$/);
  assert.ok(result.envelope.providerRecordKey.length<=250);
  assert.equal(result.envelope.product,"demand");
  assert.equal(result.envelope.environment,"unknown");
  assert.equal(result.envelope.provenance,"synthetic");
  assert.equal(result.sourceProvider,"hitpay");
  assert.equal(result.sourceStatus,"PROVIDER_REPORTED_PAID");
  assert.equal(result.envelope.metrics.observed_gross_minor,5000);
  assert.equal(result.envelope.metrics.observed_fee_minor,170);
  assert.equal(result.envelope.metrics.observed_net_minor,4830);
  assert.equal(result.envelope.metrics.settled_orders,null);
  assert.equal(result.envelope.metrics.verified_bros_sell_orders,null);
  for(const flag of ["authenticated","providerAttested","paymentEnvironmentVerified",
    "settlementVerified","entitlementVerified","attributionVerified","persisted"])
    assert.equal(result[flag],false);
});
test("retries preserve identity; changed source candidate or charge changes key",()=>{
  const baseline=project();
  assert.equal(project(candidate,scope,"2026-10-27T02:01:00Z").envelope.providerRecordKey,
    baseline.envelope.providerRecordKey);
  for(const variant of [
    {...candidate,candidateKey:"demand:hitpay-candidate:sha256:"+"b".repeat(64)},
    {...candidate,chargeId:"44444444-4444-4444-8444-444444444444"},
  ]) assert.notEqual(project(variant).envelope.providerRecordKey,baseline.envelope.providerRecordKey);
  assert.notEqual(project(candidate,{...scope,tenantId:"55555555-5555-4555-8555-555555555555"}).envelope.tenantId,
    baseline.envelope.tenantId);
});
test("caller cannot forge provider verification, settlement, entitlement or attribution",()=>{
  for(const invalid of [
    {...candidate,providerAuthenticationVerified:true},
    {...candidate,tenantMembershipVerified:true},
    {...candidate,paymentEnvironmentVerified:true},
    {...candidate,bankSettlementVerified:true},
    {...candidate,entitlementVerified:true},
    {...candidate,acquisitionAttributionVerified:true},
    {...candidate,settledOrders:1},
    {...candidate,verifiedBrosSellOrders:1},
    {...candidate,verifiedCacMinor:100},
    {...candidate,causalLift:1},
    {...candidate,status:"VERIFIED_PAID"},
    {...candidate,secret:"must-not-pass"},
  ]) assert.throws(()=>project(invalid),/Invalid unattested HitPay handoff/);
});
test("invalid scope, IDs, money and refund ambiguity fail closed",()=>{
  for(const invalid of [
    {...candidate,orderId:"bad"},
    {...candidate,candidateKey:"x"},
    {...candidate,grossMinor:5001},
    {...candidate,feeMinor:-1},
    {...candidate,netMinor:48.3},
    {...candidate,refundedMinor:6000},
    {...candidate,refundedMinor:10},
    {...candidate,status:"REFUND_OBSERVED"},
    {...candidate,providerOrderChargeLinkMatched:false},
  ]) assert.throws(()=>project(invalid),/Invalid unattested HitPay handoff/);
  for(const badScope of [
    {...scope,product:"content"},
    {...scope,tenantId:"not-a-uuid"},
    {...scope,admin:true},
  ]) assert.throws(()=>project(candidate,badScope),/Invalid unattested HitPay handoff/);
});
test("refund observation remains unverified and settlement stays unknown",()=>{
  const result=project({...candidate,status:"REFUND_OBSERVED",
    orderPaymentStatus:"partially_refunded",refundedMinor:100});
  assert.equal(result.sourceStatus,"REFUND_OBSERVED");
  assert.equal(result.envelope.metrics.observed_refunded_minor,100);
  assert.equal(result.envelope.metrics.settled_orders,null);
  assert.equal(result.providerAttested,false);
});
