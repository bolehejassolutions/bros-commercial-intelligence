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
