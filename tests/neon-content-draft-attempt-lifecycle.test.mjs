import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContentDraftRetry,shouldClearContentDraftAttempt,isContentDraftSaveFeedbackCurrent} from '../lib/content/neon-content-draft-retry.ts';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const draft={product_service:'Demo',platforms:['facebook']};
test('late acknowledgement cannot clear a newer pending draft attempt',()=>{
 const first=prepareContentDraftRetry(null,A,draft,()=> 'aaaaaaaaaaaa');
 const newer=prepareContentDraftRetry(first,A,{...draft,product_service:'Edited'},()=> 'bbbbbbbbbbbb');
 assert.equal(shouldClearContentDraftAttempt(newer,first),false);
 assert.equal(shouldClearContentDraftAttempt(newer,newer),true);
 assert.equal(shouldClearContentDraftAttempt(null,first),false);
});
test('retry identity is stable for same workspace and payload, but changes across workspaces',()=>{
 const first=prepareContentDraftRetry(null,A,draft,()=> 'aaaaaaaaaaaa');
 assert.equal(prepareContentDraftRetry(first,A,draft,()=>{throw Error('must reuse');}),first);
 const other=prepareContentDraftRetry(first,B,draft,()=> 'bbbbbbbbbbbb');
 assert.notEqual(other.key,first.key);
});
test('late save feedback cannot refresh a different workspace',()=>{
 assert.equal(isContentDraftSaveFeedbackCurrent(A,B),false);
 assert.equal(isContentDraftSaveFeedbackCurrent(A,A),true);
});
