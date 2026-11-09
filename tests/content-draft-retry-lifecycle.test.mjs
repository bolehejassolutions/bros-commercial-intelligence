import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContentDraftRetry,isContentDraftSaveFeedbackCurrent,shouldClearContentDraftAttempt} from '../lib/content/neon-content-draft-retry.ts';

const workspaceA='22222222-2222-4222-8222-222222222222';
const workspaceB='33333333-3333-4333-8333-333333333333';
const draft={product_service:'BROS SELL',audience:'SME Malaysia',description:'Brief',problem:'Unclear value',objective:'Educate',duration_days:7,platforms:['facebook']};
const key=(suffix)=>'content-retry-key-'+suffix;
test('uncertain POST and unverified independent GET reuse one idempotency identity',()=>{
 let generated=0;
 const createKey=()=>key(++generated);
 const first=prepareContentDraftRetry(null,workspaceA,draft,createKey);
 const networkRetry=prepareContentDraftRetry(first,workspaceA,{...draft},createKey);
 const readbackRetry=prepareContentDraftRetry(networkRetry,workspaceA,JSON.parse(JSON.stringify(draft)),createKey);
 assert.strictEqual(networkRetry,first);
 assert.strictEqual(readbackRetry,first);
 assert.equal(generated,1);
});
test('a changed brief and a changed workspace cannot inherit an earlier retry identity',()=>{
 let generated=0;
 const createKey=()=>key(++generated);
 const first=prepareContentDraftRetry(null,workspaceA,draft,createKey);
 const changed=prepareContentDraftRetry(first,workspaceA,{...draft,problem:'Different problem'},createKey);
 const otherTenantWorkspace=prepareContentDraftRetry(changed,workspaceB,{...draft,problem:'Different problem'},createKey);
 assert.notEqual(first.key,changed.key);
 assert.notEqual(changed.key,otherTenantWorkspace.key);
 assert.equal(generated,3);
});
test('stale POST acknowledgement cannot clear a newer in-flight attempt',()=>{
 const first=prepareContentDraftRetry(null,workspaceA,draft,()=>key('one'));
 const second=prepareContentDraftRetry(first,workspaceA,{...draft,objective:'Clarify'},()=>key('two'));
 assert.equal(shouldClearContentDraftAttempt(second,first),false);
 assert.equal(shouldClearContentDraftAttempt(second,second),true);
 assert.equal(shouldClearContentDraftAttempt(null,first),false);
});
test('late save feedback is isolated to the initiating workspace',()=>{
 assert.equal(isContentDraftSaveFeedbackCurrent(workspaceA,workspaceA),true);
 assert.equal(isContentDraftSaveFeedbackCurrent(workspaceA,workspaceB),false);
 assert.equal(isContentDraftSaveFeedbackCurrent('invalid',workspaceA),false);
});
test('invalid keys and oversize drafts fail closed before any retry identity is accepted',()=>{
 assert.throws(()=>prepareContentDraftRetry(null,workspaceA,draft,()=> 'short'),/Invalid draft retry key/);
 assert.throws(()=>prepareContentDraftRetry(null,workspaceA,{...draft,description:'x'.repeat(19000)},()=>key('large')), /Invalid draft payload/);
 assert.throws(()=>prepareContentDraftRetry(null,'not-a-workspace',draft,()=>key('bad')), /Invalid draft retry state/);
});
