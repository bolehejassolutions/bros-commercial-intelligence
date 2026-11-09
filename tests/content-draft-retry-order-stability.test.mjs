import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContentDraftRetry} from '../lib/content/neon-content-draft-retry.ts';

const workspace='22222222-2222-4222-8222-222222222222';
const draft={product_service:'BROS SELL',audience:'SME Malaysia',description:'Brief',problem:'Unclear value',objective:'Educate',duration_days:7,platforms:['facebook','instagram']};

test('equivalent reordered draft fields retain one idempotency key',()=>{
 let generated=0;
 const createKey=()=> 'fixture-retry-key-'+(++generated);
 const first=prepareContentDraftRetry(null,workspace,draft,createKey);
 const reordered=Object.fromEntries(Object.entries(draft).reverse());
 const again=prepareContentDraftRetry(first,workspace,reordered,createKey);
 assert.strictEqual(again,first);
 assert.equal(generated,1);
});

test('material field changes still create new retry identity',()=>{
 let generated=0;
 const createKey=()=> 'fixture-retry-key-'+(++generated);
 const first=prepareContentDraftRetry(null,workspace,draft,createKey);
 const changed=prepareContentDraftRetry(first,workspace,{...draft,problem:'New problem'},createKey);
 assert.notEqual(changed.key,first.key);
 assert.equal(generated,2);
});

test('platform array order remains significant',()=>{
 let generated=0;
 const createKey=()=> 'fixture-retry-key-'+(++generated);
 const first=prepareContentDraftRetry(null,workspace,draft,createKey);
 const changed=prepareContentDraftRetry(first,workspace,{...draft,platforms:['instagram','facebook']},createKey);
 assert.notEqual(changed.key,first.key);
 assert.equal(generated,2);
});

test('throwing draft getter fails closed without issuing a retry key',()=>{
 let generated=0;
 const bad=Object.defineProperty({...draft},'audience',{enumerable:true,get(){throw new Error('untrusted getter');}});
 assert.throws(()=>prepareContentDraftRetry(null,workspace,bad,()=>{generated++;return 'fixture-retry-key';}),/Invalid draft payload/);
 assert.equal(generated,0);
});
