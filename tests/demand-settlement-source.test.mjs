import test from 'node:test';
import assert from 'node:assert/strict';
import {observeDemandSettlements} from '../lib/demand/settlement-source.mjs';
const tenantId='tenant_12345678',now='2026-11-10T00:10:00.000Z';
const order={tenantId,orderRef:'order_12345678',providerOrderId:'hitpay_12345678',status:'SETTLED',amountMinor:10000,currency:'MYR',settledAt:'2026-11-10T00:00:00.000Z'};
const payload={tenantId,source:'HITPAY_AUTHENTICATED_SERVER',retrievedAt:'2026-11-10T00:09:00.000Z',complete:true,orders:[order]};
const call=(overrides={})=>observeDemandSettlements({tenantId,currency:'MYR',now,authorizeTenant:async()=>true,readSettlements:async()=>payload,...overrides});
test('authorized bounded projection is explicitly not provider verified',async()=>{const v=await call();assert.equal(v.settledRevenueMinor,10000);assert.equal(v.metaWriteAllowed,false);assert.equal(v.state,'SERVER_ADAPTER_EVIDENCE_UNVERIFIED_PROVIDER')});
test('denied tenant never invokes provider',async()=>{let calls=0;await assert.rejects(call({authorizeTenant:async()=>false,readSettlements:async()=>{calls++;return payload}}),/UNVERIFIED/);assert.equal(calls,0)});
test('cross tenant, partial, stale and future responses fail closed',async()=>{for(const change of [{tenantId:'tenant_87654321'},{complete:false},{retrievedAt:'2026-11-09T23:00:00.000Z'},{retrievedAt:'2026-11-10T00:11:00.000Z'}])await assert.rejects(call({readSettlements:async()=>({...payload,...change})}),/UNVERIFIED/)});
test('spoofed source and extra fields fail closed',async()=>{for(const change of [{source:'CLIENT'},{extra:'forged'}])await assert.rejects(call({readSettlements:async()=>({...payload,...change})}),/UNVERIFIED/)});
test('forged orders and duplicate provider identifiers fail closed',async()=>{for(const orders of [[{...order,tenantId:'tenant_87654321'}],[order,{...order,orderRef:'order_87654321'}],[{...order,status:'SETTLED',settledAt:null}]])await assert.rejects(call({readSettlements:async()=>({...payload,orders})}),/UNVERIFIED/)});
test('adapter and authorization errors do not leak secrets',async()=>{await assert.rejects(call({readSettlements:async()=>{throw Error('token=secret')}}),/UNVERIFIED/);await assert.rejects(call({authorizeTenant:async()=>{throw Error('secret')}}),/UNVERIFIED/)});
test('accessor-backed response rejected without invoking getter',async()=>{let invoked=0;const bad={...payload};Object.defineProperty(bad,'orders',{enumerable:true,get(){invoked++;return [order]}});await assert.rejects(call({readSettlements:async()=>bad}),/UNVERIFIED/);assert.equal(invoked,0)});

test('future settlement relative to provider snapshot fails closed even when before evaluation time',async()=>{await assert.rejects(call({readSettlements:async()=>({...payload,orders:[{...order,settledAt:'2026-11-10T00:09:30.000Z'}]})}),/UNVERIFIED/)});
test('settlement exactly at snapshot boundary is allowed but remains unverified',async()=>{const v=await call({readSettlements:async()=>({...payload,orders:[{...order,settledAt:payload.retrievedAt}]})});assert.equal(v.settledRevenueMinor,10000);assert.equal(v.state,'SERVER_ADAPTER_EVIDENCE_UNVERIFIED_PROVIDER')});
test('future settlement does not get counted alongside a valid settlement',async()=>{await assert.rejects(call({readSettlements:async()=>({...payload,orders:[order,{...order,orderRef:'order_87654321',providerOrderId:'hitpay_87654321',settledAt:'2026-11-10T00:09:01.000Z'}]})}),/UNVERIFIED/)});

// Hostile provider adapters must not leak thrown messages from Proxy traps.
test('proxy ownKeys and prototype traps fail closed without leaking adapter secrets',async()=>{
 for(const trap of ['ownKeys','getPrototypeOf']){
  const bad=new Proxy({...payload},{[trap](){throw Error('adapter-secret-leak')}});
  await assert.rejects(call({readSettlements:async()=>bad}),e=>e.message==='DEMAND_SETTLEMENT_SOURCE_UNVERIFIED');
 }
});
test('proxy order traps fail closed without leaking adapter secrets',async()=>{
 for(const trap of ['ownKeys','getPrototypeOf']){
  const badOrder=new Proxy({...order},{[trap](){throw Error('order-secret-leak')}});
  await assert.rejects(call({readSettlements:async()=>({...payload,orders:[badOrder]})}),e=>e.message==='DEMAND_SETTLEMENT_SOURCE_UNVERIFIED');
 }
});
test('proxy order-list iteration traps fail closed without leaking adapter secrets',async()=>{
 const orders=new Proxy([order],{get(target,key,receiver){if(key===Symbol.iterator)throw Error('iterator-secret-leak');return Reflect.get(target,key,receiver)}});
 await assert.rejects(call({readSettlements:async()=>({...payload,orders})}),e=>e.message==='DEMAND_SETTLEMENT_SOURCE_UNVERIFIED');
});

// Adapter-provided settlement rows are observations, not independently authenticated revenue.
test('adapter source label cannot upgrade observations into verified revenue',async()=>{
 const v=await call();
 assert.equal(v.settledRevenueMinor,10000);
 assert.equal(v.verifiedSettledRevenueMinor,null);
 assert.equal(v.providerAuthenticationVerified,false);
 assert.equal(v.tenantAuthorizationVerifiedForProvider,false);
 assert.equal(v.metaWriteAllowed,false);
});
test('empty adapter response is not proof of zero verified revenue',async()=>{
 const v=await call({readSettlements:async()=>({...payload,orders:[]})});
 assert.equal(v.settledRevenueMinor,0);
 assert.equal(v.verifiedSettledRevenueMinor,null);
 assert.equal(v.providerAuthenticationVerified,false);
});
test('forged server source string never establishes verified revenue',async()=>{
 const v=await call({readSettlements:async()=>({...payload,orders:[{...order,amountMinor:999999}]})});
 assert.equal(v.settledRevenueMinor,999999);
 assert.equal(v.verifiedSettledRevenueMinor,null);
});

test('revoked membership during asynchronous provider read suppresses settlement disclosure', async () => {
  let authorized = true;
  const authorizationChecks = [];
  await assert.rejects(call({
    authorizeTenant: async id => { authorizationChecks.push(id); return authorized; },
    readSettlements: async () => { authorized = false; return payload; },
  }), /DEMAND_SETTLEMENT_SOURCE_UNVERIFIED/);
  assert.deepEqual(authorizationChecks, [tenantId, tenantId]);
});

test('only snapshotted data properties can contribute to totals and retrieval time', async () => {
  const proxiedOrder = new Proxy(order, {
    get(target, key, receiver) {
      if (key === 'amountMinor') return 999999;
      if (key === 'settledAt') return now;
      return Reflect.get(target, key, receiver);
    },
  });
  const response = new Proxy({ ...payload, orders: [proxiedOrder] }, {
    get(target, key, receiver) {
      if (key === 'retrievedAt') return now;
      return Reflect.get(target, key, receiver);
    },
  });
  const value = await call({ readSettlements: async () => response });
  assert.equal(value.sourceRetrievedAt, payload.retrievedAt);
  assert.equal(value.settledRevenueMinor, order.amountMinor);
  assert.equal(value.verifiedSettledHitPayOrders, null);
});
