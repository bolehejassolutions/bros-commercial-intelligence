import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectNextActions} from '../lib/operator/select-next-action.mjs';
const now='2026-10-26T08:00:00Z';
const scope={tenantId:'demo-a',instanceId:'bros-sell-internal',products:['content','demand'],executedKeys:new Set()};
const fresh={status:'VERIFIED',collectedAt:'2026-10-26T07:30:00Z'};
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
 const r=selectNextActions({scope,candidates:[mk('empty',{evidence:[]}),mk('stale',{evidence:[{status:'OBSERVED',collectedAt:'2026-10-25T00:00:00Z'}]}),mk('unknown',{evidence:[{status:'UNKNOWN',collectedAt:'2026-10-26T07:55:00Z'}]}),mk('noTTL',{freshnessBudgetMs:undefined})],now});
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
test('rejects unverifiable scope and time',()=>{
 assert.throws(()=>selectNextActions({scope:null,candidates:[],now}));
 assert.throws(()=>selectNextActions({scope,candidates:[],now:'bogus'}));
});
