import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContentDraftRetry} from '../lib/content/neon-content-draft-retry.ts';
const workspace='22222222-2222-4222-8222-222222222222';
const key=()=> 'fixture-retry-key-123456';
const brief={product_service:'BROS SELL', metadata:{audience:'SME', angle:{problem:'unclear',solution:'clarity'}}, platforms:['facebook','instagram']};
test('nested reordered JSON object preserves retry key',()=>{
 const first=prepareContentDraftRetry(null,workspace,brief,key);
 const reordered={platforms:['facebook','instagram'],metadata:{angle:{solution:'clarity',problem:'unclear'},audience:'SME'},product_service:'BROS SELL'};
 assert.strictEqual(prepareContentDraftRetry(first,workspace,reordered,()=>{throw Error('duplicate key');}),first);
});
test('nested material change requires fresh key',()=>{
 const first=prepareContentDraftRetry(null,workspace,brief,key);
 const second=prepareContentDraftRetry(first,workspace,{...brief,metadata:{...brief.metadata,angle:{...brief.metadata.angle,solution:'pressure'}}},()=> 'fixture-retry-key-654321');
 assert.notEqual(first.key,second.key);
});
test('nested array ordering remains significant',()=>{
 const first=prepareContentDraftRetry(null,workspace,brief,key);
 const second=prepareContentDraftRetry(first,workspace,{...brief,platforms:['instagram','facebook']},()=> 'fixture-retry-key-654321');
 assert.notEqual(first.key,second.key);
});
test('cyclic nested values fail closed before key issuance',()=>{
 const nested={value:'ok'};const cycle={nested};nested['cycle']=cycle;
 assert.throws(()=>prepareContentDraftRetry(null,workspace,cycle,()=>{throw Error('issued key');}),/Invalid draft payload/);
});
test('unsupported nested values fail closed',()=>{
 for(const invalid of [undefined,()=>1,Infinity,BigInt(2),new Date()]){
  assert.throws(()=>prepareContentDraftRetry(null,workspace,{nested:{invalid}},key),/Invalid draft payload/);
 }
});
