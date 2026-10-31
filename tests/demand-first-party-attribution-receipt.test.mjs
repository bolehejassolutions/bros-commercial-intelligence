import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDemandFirstPartyAttributionReceipt as assess } from '../lib/demand/first-party-attribution-receipt.ts';
const scope={tenantId:'11111111-1111-4111-8111-111111111111',product:'demand',pilotProduct:'bros_sell',campaign:'demand_sell_receipt_v1',source:'facebook',medium:'paid_social'};
const landing={receiptId:'landing_20261030_0001',occurredAt:'2026-10-29T15:00:00Z',correlationDigest:'a'.repeat(64),consent:'granted',campaign:scope.campaign,source:scope.source,medium:scope.medium};
const checkout={receiptId:'checkout_20261030_0001',occurredAt:'2026-10-29T15:05:00Z',correlationDigest:landing.correlationDigest,merchantOrderDigest:'b'.repeat(64)};
const order={receiptId:'merchant_20261030_0001',occurredAt:'2026-10-29T15:06:00Z',merchantOrderDigest:checkout.merchantOrderDigest};
const invalid=/Invalid BROS DEMAND first-party attribution receipt/;
test('actual provider gap: no UTM/checkout/order receipt remains unknown, never zero',()=>{
  const x=assess(scope,null,null,null);
  assert.equal(x.status,'NO_LANDING_RECEIPT'); assert.equal(x.candidateKey,null);
  assert.equal(x.verifiedPaidOrders,null); assert.equal(x.verifiedCpaMinor,null);
  assert.equal(x.receiptCount,0);
});
test('missing downstream receipts and unknown/denied consent never form a join',()=>{
  assert.equal(assess(scope,landing,null,null).status,'NO_CHECKOUT_RECEIPT');
  assert.equal(assess(scope,landing,checkout,null).status,'NO_MERCHANT_ORDER_RECEIPT');
  assert.equal(assess(scope,{...landing,consent:'unknown'},checkout,order).status,'CONSENT_NOT_ATTESTED');
  assert.equal(assess(scope,{...landing,consent:'denied'},checkout,order).candidateKey,null);
});
test('consistent three-stage candidate remains unattested and idempotent',()=>{
  const x=assess(scope,landing,checkout,order);
  assert.equal(x.status,'CORRELATED_UNATTESTED');
  assert.match(x.candidateKey,/^demand:first-party-receipt-candidate:sha256:[a-f0-9]{64}$/);
  assert.deepEqual(x,assess({...scope}, {...landing}, {...checkout}, {...order}));
  assert.equal(x.receiptCount,3);
  for(const k of ['consentVerifiedByTrustedServer','appProviderAuthenticationVerified','tenantAuthorizationVerified','metaEventToOrderJoinVerified','hitpayPaymentVerified','bankSettlementVerified','entitlementVerified','authorizedExperimentActionVerified','outcomeVerified','durableBciLearningVerified']) assert.equal(x[k],false);
  for(const k of ['verifiedPaidOrders','verifiedCpaMinor','verifiedCacMinor','verifiedConversionRate','causalLift']) assert.equal(x[k],null);
  assert.equal(JSON.stringify(x).includes(landing.correlationDigest),false);
  assert.equal(JSON.stringify(x).includes(checkout.merchantOrderDigest),false);
  assert.ok(Object.isFrozen(x));
});
test('wrong join, out-of-order timestamps and stale chain reject without leaking ids',()=>{
  const attempts=[
    [landing,{...checkout,correlationDigest:'c'.repeat(64)},order],
    [landing,checkout,{...order,merchantOrderDigest:'c'.repeat(64)}],
    [landing,{...checkout,occurredAt:'2026-10-29T14:59:00Z'},order],
    [landing,checkout,{...order,occurredAt:'2026-10-29T15:04:00Z'}],
    [landing,checkout,{...order,occurredAt:'2026-12-01T15:06:00Z'}],
  ];
  for(const [a,b,c] of attempts){const x=assess(scope,a,b,c);assert.equal(x.status,'REJECTED_CORRELATION');assert.equal(x.candidateKey,null);}
});
test('candidate identity is stable across equivalent valid UTC fractional timestamp spellings',()=>{
  const baseline=assess(scope,landing,checkout,order).candidateKey;
  const zeroMs=assess(scope,{...landing,occurredAt:'2026-10-29T15:00:00.000Z'},
    {...checkout,occurredAt:'2026-10-29T15:05:00.0Z'},
    {...order,occurredAt:'2026-10-29T15:06:00.00Z'}).candidateKey;
  assert.equal(zeroMs,baseline);
  const shortMs=assess(scope,{...landing,occurredAt:'2026-10-29T15:00:00.1Z'},checkout,order).candidateKey;
  const longMs=assess(scope,{...landing,occurredAt:'2026-10-29T15:00:00.100Z'},checkout,order).candidateKey;
  const distinctMs=assess(scope,{...landing,occurredAt:'2026-10-29T15:00:00.101Z'},checkout,order).candidateKey;
  assert.equal(shortMs,longMs);
  assert.notEqual(shortMs,distinctMs);
  assert.notEqual(shortMs,baseline);
});
test('candidate changes when receipt evidence changes but replay remains stable',()=>{
  const a=assess(scope,landing,checkout,order).candidateKey;
  const b=assess(scope,{...landing,receiptId:'landing_20261030_0002'},checkout,order).candidateKey;
  const c=assess(scope,landing,checkout,{...order,receiptId:'merchant_20261030_0002'}).candidateKey;
  assert.equal(new Set([a,b,c]).size,3);
});
test('reject raw PII, extra provider authority fields, coercion and malformed receipts',()=>{
  const attempts=[
    [scope,{...landing,email:'example@example.com'},checkout,order],
    [scope,{...landing,rawFbclid:'raw'},checkout,order],
    [scope,landing,{...checkout,providerAuthenticated:true},order],
    [scope,landing,checkout,{...order,paid:true}],
    [{...scope,tenantId:[scope.tenantId]},landing,checkout,order],
    [{...scope,ownerApproved:true},landing,checkout,order],
    [scope,{...landing,correlationDigest:'raw-click-id'},checkout,order],
    [scope,{...landing,occurredAt:'2026-02-30T15:00:00Z'},checkout,order],
    [scope,{...landing,receiptId:checkout.receiptId},checkout,order],
    [scope,{...landing,campaign:'other_campaign'},checkout,order],
  ];
  for(const args of attempts)assert.throws(()=>assess(...args),invalid);
});
