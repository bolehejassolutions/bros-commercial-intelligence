import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileDemandPurchaseEvidence as reconcile} from '../lib/demand/attribution-evidence.mjs';
const scope={tenantId:'tenant_12345678',currency:'MYR'};
const pixel={tenantId:scope.tenantId,eventId:'pixel_12345678',orderRef:'order_12345678',observedAt:'2026-11-09T10:00:00Z'};
const paid={tenantId:scope.tenantId,orderRef:pixel.orderRef,providerOrderId:'hitpay_12345678',status:'SETTLED',amountMinor:10000,currency:'MYR',settledAt:'2026-11-09T10:01:00Z'};
test('Pixel alone is never revenue',()=>{const v=reconcile(scope,[pixel],[]);assert.equal(v.pixelPurchaseEvents,1);assert.equal(v.settledRevenueMinor,0);assert.equal(v.settledHitPayOrders,0);assert.equal(v.metaWriteAllowed,false)});
test('settled order only counts once and requires separate provider evidence',()=>{const v=reconcile(scope,[pixel],[paid]);assert.equal(v.settledRevenueMinor,10000);assert.equal(v.settledWithPixelReference,1);assert.equal(v.state,'READ_ONLY_EVIDENCE_NOT_PROVIDER_VERIFIED')});
test('failed and refunded orders are not revenue',()=>{for(const status of ['FAILED','REFUNDED','PENDING']){const v=reconcile(scope,[],[{...paid,status,settledAt:null}]);assert.equal(v.settledRevenueMinor,0)}});
test('reordering inputs does not alter digest',()=>{const p2={...pixel,eventId:'pixel_87654321'};assert.equal(reconcile(scope,[pixel,p2],[paid]).evidenceDigest,reconcile(scope,[p2,pixel],[paid]).evidenceDigest)});
test('reject cross tenant and duplicate provider evidence',()=>{assert.throws(()=>reconcile(scope,[{...pixel,tenantId:'tenant_87654321'}],[]));assert.throws(()=>reconcile(scope,[pixel,pixel],[]));assert.throws(()=>reconcile(scope,[],[paid,paid]));});
test('reject malformed and spoofed evidence',()=>{assert.throws(()=>reconcile(scope,[{...pixel,extra:'spoof'}],[]));assert.throws(()=>reconcile(scope,[],[{...paid,amountMinor:NaN}]));assert.throws(()=>reconcile(scope,[],[{...paid,settledAt:null}]));assert.throws(()=>reconcile(scope,[],[{...paid,tenantId:'tenant_87654321'}]));});

test('reject two order references sharing a HitPay provider ID',()=>{
  const duplicate={...paid,orderRef:'order_87654321'};
  assert.throws(()=>reconcile(scope,[],[paid,duplicate]),/DEMAND_ATTRIBUTION_EVIDENCE_DENIED/);
});
