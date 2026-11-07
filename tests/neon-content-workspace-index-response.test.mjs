import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContentWorkspaceIndex,ContentWorkspaceIndexInvalid} from '../lib/content/neon-content-workspace-index-response.ts';
const W='22222222-2222-4222-8222-222222222222';
test('explicit valid empty index remains empty',()=>assert.deepEqual(parseContentWorkspaceIndex({data:{workspaces:[]}}),[]));
test('valid workspace index retains identity and optional timestamp',()=>{
 assert.deepEqual(parseContentWorkspaceIndex({data:{workspaces:[{id:W,name:'CONTENT DEV',updated_at:'2026-11-08T00:00:00Z'}]}}),[
  {id:W,name:'CONTENT DEV',updated_at:'2026-11-08T00:00:00Z'}
 ]);
});
test('malformed successful HTTP response is not treated as no workspaces',()=>{
 for(const payload of [null,{},[],{data:null},{data:{}},{data:{workspaces:null}},
  {data:{workspaces:{}}},{data:{workspaces:[{}]}},
  {data:{workspaces:[{id:'not-a-uuid',name:'X'}]}},
  {data:{workspaces:[{id:W,name:'   '}]}},
  {data:{workspaces:[{id:W,name:'Valid'},{id:W,name:'Duplicate'}]}}]){
  assert.throws(()=>parseContentWorkspaceIndex(payload),ContentWorkspaceIndexInvalid);
 }
});
test('reject unexpectedly large index responses and invalid timestamps',()=>{
 assert.throws(()=>parseContentWorkspaceIndex({data:{workspaces:Array(1001).fill({id:W,name:'X'})}}));
 assert.throws(()=>parseContentWorkspaceIndex({data:{workspaces:[{id:W,name:'X',updated_at:123}]}}));
});
