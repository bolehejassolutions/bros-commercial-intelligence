import test from 'node:test';
import assert from 'node:assert/strict';
import {ContentReadDenied,requireCompleteContentRows} from '../lib/content/neon-content-workspace-reader.ts';

test('workspace campaign boundary accepts exactly 100, rejects 101st sentinel',()=>{
 const rows=Array.from({length:101},(_,i)=>({id:i}));
 assert.equal(requireCompleteContentRows(rows.slice(0,100),100).length,100);
 assert.throws(()=>requireCompleteContentRows(rows,100),ContentReadDenied);
});
test('workspace item boundary accepts 500, rejects 501st sentinel',()=>{
 const rows=Array.from({length:501},(_,i)=>i);
 assert.equal(requireCompleteContentRows(rows.slice(0,500),500).length,500);
 assert.throws(()=>requireCompleteContentRows(rows,500),ContentReadDenied);
});
test('workspace scenes boundary accepts 100, rejects 101st sentinel',()=>{
 const rows=Array.from({length:101},(_,i)=>i);
 assert.equal(requireCompleteContentRows(rows.slice(0,100),100).length,100);
 assert.throws(()=>requireCompleteContentRows(rows,100),ContentReadDenied);
});
test('empty and small workspace data remain valid; invalid guard input fails closed',()=>{
 assert.deepEqual(requireCompleteContentRows([],100),[]);
 assert.deepEqual(requireCompleteContentRows([{id:1}],100),[{id:1}]);
 assert.throws(()=>requireCompleteContentRows(null,100),ContentReadDenied);
 assert.throws(()=>requireCompleteContentRows([],0),ContentReadDenied);
 assert.throws(()=>requireCompleteContentRows([],Number.NaN),ContentReadDenied);
});
