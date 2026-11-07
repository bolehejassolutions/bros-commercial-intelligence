import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceIndexGet} from '../lib/content/neon-content-workspace-index-http.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';
const A='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const request=(method='GET')=>new Request('https://content.example.invalid/api/content/dev/workspaces',{method});
test('only verified principal reaches restricted workspace index',async()=>{
 let called=0;
 const handler=createContentWorkspaceIndexGet(async()=>({userId:A,authenticated:true}),async principal=>{
  called++;assert.equal(principal.userId,A);return {workspaces:[{id:A,name:'Owned'}]};
 });
 const res=await handler(request());
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
 assert.equal((await res.json()).data.workspaces.length,1);assert.equal(called,1);
});
test('denies unsafe method and invalid session before SQL',async()=>{
 let called=0;
 const handler=createContentWorkspaceIndexGet(async()=>{called++;return {userId:A,authenticated:true};},async()=>({}));
 assert.equal((await handler(request('POST'))).status,405);assert.equal(called,0);
 for(const verify of [async()=>null,async()=>{throw Error('not authorized');},
  async()=>({userId:'bad',authenticated:true})]){
  const h=createContentWorkspaceIndexGet(verify,async()=>{called++;return {};});
  assert.equal((await h(request())).status,401);
 }
 assert.equal(called,0);
});
test('forbidden database role returns indistinguishable 404 and errors do not leak',async()=>{
 const role=createContentWorkspaceIndexGet(async()=>({userId:A,authenticated:true}),async()=>{throw new ContentReadDenied();});
 assert.equal((await role(request())).status,404);
 const error=createContentWorkspaceIndexGet(async()=>({userId:A,authenticated:true}),async()=>{throw Error('sensitive URL');});
 const res=await error(request());
 assert.equal(res.status,503);assert.equal((await res.text()).includes('sensitive'),false);
});
