import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectNextActions} from '../lib/operator/select-next-action.mjs';
const now='2026-10-26T08:00:00Z';
const scope={tenantId:'demo-a',instanceId:'bros-sell-internal',products:['content','demand'],executedKeys:new Set()};
const fresh={tenantId:'demo-a',product:'content',status:'VERIFIED',observedAt:'2026-10-26T07:20:00Z',collectedAt:'2026-10-26T07:30:00Z'};
const mk=(actionId,extra={})=>({actionId,title:actionId,tenantId:'demo-a',instanceId:'bros-sell-internal',product:'content',priority:0,approvalPolicy:'NONE_READ_ONLY',idempotencyKey:`key-${actionId}`,evidence:[fresh],freshnessBudgetMs:3600000,...extra});
test('never makes a recommendation executable',()=>{
 const result=selectNextActions({scope,candidates:[mk('A'),mk('B',{approvalPolicy:'PAID_SPEND'})],now});
 assert.equal(result.primary.executionAllowed,false);
 assert.equal(result.secondary[0].state,'READY_FOR_REVIEW');
 assert.equal(result.secondary[0].executionAllowed,false);
});
test('filters different tenant, product and instance',()=>{
 const result=selectNextActions({scope,candidates:[mk('one',{tenantId:'other'}),mk('two',{product:'sell'}),mk('three',{instanceId:'different'}),mk('four')],now});
 assert.equal(result.considered,1);
 assert.equal(result.primary.actionId,'four');
});
test('fails closed on absent/stale/invalid evidence freshness',()=>{
 const r=selectNextActions({scope,candidates:[mk('empty',{evidence:[]}),mk('stale',{evidence:[{...fresh,status:'OBSERVED',observedAt:'2026-10-25T00:00:00Z',collectedAt:'2026-10-25T00:00:00Z'}]}),mk('unknown',{evidence:[{...fresh,status:'UNKNOWN',observedAt:'2026-10-26T07:55:00Z',collectedAt:'2026-10-26T07:55:00Z'}]}),mk('noTTL',{freshnessBudgetMs:undefined})],now});
 assert.equal(r.considered,4);
 assert.ok([r.primary,...r.secondary].every(x=>x.executionAllowed===false));
 assert.equal(r.primary.state,'NEEDS_EVIDENCE');
});
test('idempotency replay and empty key block recommendations',()=>{
 const replayScope={...scope,executedKeys:new Set(['key-dupe'])};
 const r=selectNextActions({scope:replayScope,candidates:[mk('dupe'),mk('missing',{idempotencyKey:''})],now});
 assert.equal(r.primary.state,'BLOCKED');
 assert.equal(r.secondary[0].state,'BLOCKED');
});
test('stable priority and max two supporting actions',()=>{
 const r=selectNextActions({scope,candidates:[mk('z',{priority:1}),mk('c'),mk('a'),mk('b')],now});
 assert.equal(r.primary.actionId,'a');
 assert.deepEqual(r.secondary.map(x=>x.actionId),['b','c']);
 assert.equal(r.considered,4);
});
test('drops all candidates containing foreign tenant or product evidence without exposing action names',()=>{
 const r=selectNextActions({scope,candidates:[
   mk('secret-foreign-tenant',{evidence:[{...fresh,tenantId:'demo-b'}]}),
   mk('secret-foreign-product',{evidence:[{...fresh,product:'demand'}]}),
   mk('secret-mixed-source',{evidence:[fresh,{...fresh,tenantId:'demo-b'}]}),
   mk('secret-unscoped-source',{evidence:[{status:'VERIFIED',observedAt:now,collectedAt:now}]}),
   mk('allowed')
 ],now});
 assert.equal(r.considered,1);
 assert.equal(r.primary.actionId,'allowed');
 assert.equal(r.secondary.length,0);
});
test('fresh collection cannot disguise old observed event',()=>{
 const r=selectNextActions({scope,candidates:[mk('bad',{evidence:[{...fresh,observedAt:'2026-10-20T07:30:00Z',collectedAt:now}]})],now});
 assert.equal(r.primary.state,'NEEDS_EVIDENCE');
 assert.deepEqual(r.primary.blockedBy,['STALE_OR_UNBOUNDED_EVIDENCE']);
 assert.equal(r.primary.executionAllowed,false);
});
test('future, reverse-order and invalid dates are not fresh evidence',()=>{
 const wrong=[
  {...fresh,observedAt:'2026-10-26T08:05:00Z',collectedAt:'2026-10-26T08:10:00Z'},
  {...fresh,observedAt:'2026-10-26T07:45:00Z',collectedAt:'2026-10-26T07:30:00Z'},
  {...fresh,observedAt:'2026-02-30T07:30:00Z'},
  {...fresh,observedAt:'2026-10-26T07:30:00+00:00'},
  {...fresh,observedAt:null}
 ];
 for (const evidence of wrong) {
  const r=selectNextActions({scope,candidates:[mk('blocked',{evidence:[evidence]})],now});
  assert.equal(r.primary.state,'NEEDS_EVIDENCE');
  assert.equal(r.primary.executionAllowed,false);
 }
});
test('fresh correctly scoped read-only evidence remains a non-executing suggestion',()=>{
 const r=selectNextActions({scope,candidates:[mk('ready')],now});
 assert.equal(r.primary.state,'PROPOSED');
 assert.equal(r.primary.requiresApproval,false);
 assert.equal(r.primary.executionAllowed,false);
});
test('invalid scope product is denied at entry',()=>{
 assert.throws(()=>selectNextActions({scope:{...scope,products:['sell']},candidates:[],now}));
});
test('rejects unverifiable scope and time',()=>{
 assert.throws(()=>selectNextActions({scope:null,candidates:[],now}));
 assert.throws(()=>selectNextActions({scope,candidates:[],now:'bogus'}));
});
