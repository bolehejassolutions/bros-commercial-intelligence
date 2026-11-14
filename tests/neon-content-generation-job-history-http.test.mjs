import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentJobHistoryGet} from '../lib/content/neon-content-generation-job-history-http.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';

const workspace='22222222-2222-4222-8222-222222222222';
const campaign='99999999-9999-4999-8999-999999999999';
const principal='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const url=(query='')=>`https://content.example/api/content/dev/workspaces/${workspace}/generation-jobs${query}`;
const req=(query='',method='GET')=>new Request(url(query),{method});
test('history boundary requires server session and exact workspace route',async()=>{
 let reads=0;
 const handler=createContentJobHistoryGet(async()=>null,async()=>{reads++;return []});
 assert.equal((await handler(req('?campaign='+campaign),workspace)).status,401);
 assert.equal((await handler(req('?campaign='+campaign),workspace+'0')).status,404);
 assert.equal((await handler(req('?campaign='+campaign,'POST'),workspace)).status,405);
 assert.equal(reads,0);
});
test('history query validates campaign, limit and rejects unknown parameters',async()=>{
 let reads=0;
 const handler=createContentJobHistoryGet(async()=>({userId:principal,authenticated:true}),
  async()=>{reads++;return []});
 for(const q of ['', '?campaign=bad', '?campaign='+campaign+'&limit=0',
   '?campaign='+campaign+'&limit=51','?campaign='+campaign+'&campaign='+campaign,
   '?campaign='+campaign+'&foo=1'])
  assert.equal((await handler(req(q),workspace)).status,400);
 assert.equal(reads,0);
});
test('authenticated job history read is correctly scoped and unavailable errors are sanitized',async()=>{
 let captured;
 const handler=createContentJobHistoryGet(async()=>({userId:principal,authenticated:true}),
  async(p,w,c,l)=>{captured={p,w,c,l};return [{id:'some-job',status:'queued'}]});
 const response=await handler(req('?campaign='+campaign+'&limit=7'),workspace);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(captured,{p:{userId:principal,authenticated:true},w:workspace,c:campaign,l:7});
 assert.equal((await response.json()).data.jobs.length,1);
 const denied=createContentJobHistoryGet(async()=>({userId:principal,authenticated:true}),
  async()=>{throw new ContentReadDenied()});
 assert.equal((await denied(req('?campaign='+campaign),workspace)).status,404);
 const failed=createContentJobHistoryGet(async()=>({userId:principal,authenticated:true}),
  async()=>{throw new Error('private-database-password')});
 const error=await failed(req('?campaign='+campaign),workspace);
 assert.equal(error.status,503);
 assert.equal((await error.text()).includes('private-database-password'),false);
});
