import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceGet} from '../lib/content/neon-content-workspace-http.ts';
import {ContentReadIncomplete,ContentReadDenied,requireCompleteContentRows} from '../lib/content/neon-content-workspace-reader.ts';

const user='11111111-1111-4111-8111-111111111111';
const workspace='33333333-3333-4333-8333-333333333333';
const request=()=>new Request('https://example.invalid/api/content/dev/workspaces/'+workspace);
const verify=async()=>({userId:user,authenticated:true});

test('a complete result at the supported limit is accepted',()=>{
 assert.equal(requireCompleteContentRows([1,2],2).length,2);
 assert.equal(requireCompleteContentRows([],2).length,0);
});
test('overflow and malformed rows are classified as incomplete, not access denied',()=>{
 assert.throws(()=>requireCompleteContentRows([1,2,3],2),ContentReadIncomplete);
 assert.throws(()=>requireCompleteContentRows(null,2),ContentReadIncomplete);
 assert.throws(()=>requireCompleteContentRows([1],0),ContentReadIncomplete);
});
test('authenticated workspace overflow returns 503 and never claims missing workspace',async()=>{
 const handler=createContentWorkspaceGet(verify,async()=>{throw new ContentReadIncomplete();});
 const response=await handler(request(),workspace);
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'workspace_incomplete'});
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('foreign workspace remains indistinguishable from missing workspace',async()=>{
 const handler=createContentWorkspaceGet(verify,async()=>{throw new ContentReadDenied();});
 const response=await handler(request(),workspace);
 assert.equal(response.status,404);
 assert.deepEqual(await response.json(),{error:'not_found'});
});
test('unknown database failures remain sanitized and unavailable',async()=>{
 const handler=createContentWorkspaceGet(verify,async()=>{throw Error('password=private');});
 const response=await handler(request(),workspace);
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'workspace_unavailable'});
});
test('unauthenticated access never probes the reader even if it would overflow',async()=>{
 let readCalls=0;
 const handler=createContentWorkspaceGet(async()=>null,async()=>{readCalls++;throw new ContentReadIncomplete();});
 assert.equal((await handler(request(),workspace)).status,401);
 assert.equal(readCalls,0);
});
