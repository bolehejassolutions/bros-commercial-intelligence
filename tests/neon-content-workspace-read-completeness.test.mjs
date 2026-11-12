import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_CONTENT_SCENES_PER_ITEM} from '../lib/content/neon-content-generation-contract.ts';
import {ContentReadIncomplete,requireCompleteContentRows} from '../lib/content/neon-content-workspace-reader.ts';

test('workspace campaign boundary accepts exactly 100, rejects 101st sentinel',()=>{
 const rows=Array.from({length:101},(_,i)=>({id:i}));
 assert.equal(requireCompleteContentRows(rows.slice(0,100),100).length,100);
 assert.throws(()=>requireCompleteContentRows(rows,100),ContentReadIncomplete);
});
test('workspace item boundary accepts 500, rejects 501st sentinel',()=>{
 const rows=Array.from({length:501},(_,i)=>i);
 assert.equal(requireCompleteContentRows(rows.slice(0,500),500).length,500);
 assert.throws(()=>requireCompleteContentRows(rows,500),ContentReadIncomplete);
});
test('workspace scenes boundary matches the supported generation limit and rejects its overflow sentinel',()=>{
 const limit=MAX_CONTENT_SCENES_PER_ITEM;
 const rows=Array.from({length:limit+1},(_,i)=>i);
 assert.equal(requireCompleteContentRows(rows.slice(0,limit),limit).length,limit);
 assert.throws(()=>requireCompleteContentRows(rows,limit),ContentReadIncomplete);
});
test('empty and small workspace data remain valid; invalid guard input fails closed',()=>{
 assert.deepEqual(requireCompleteContentRows([],100),[]);
 assert.deepEqual(requireCompleteContentRows([{id:1}],100),[{id:1}]);
 assert.throws(()=>requireCompleteContentRows(null,100),ContentReadIncomplete);
 assert.throws(()=>requireCompleteContentRows([],0),ContentReadIncomplete);
 assert.throws(()=>requireCompleteContentRows([],Number.NaN),ContentReadIncomplete);
});
