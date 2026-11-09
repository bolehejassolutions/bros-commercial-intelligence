import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {prepareContentDraftRetry} from '../lib/content/neon-content-draft-retry.ts';
import {confirmContentDraftReadback,ContentDraftReadbackUnverified} from '../lib/content/neon-content-draft-readback.ts';

// Disposable HTTP contract fixture, NOT the deployed app route, real auth, or PostgreSQL.
// The actual restricted PostgreSQL writer/reader acceptance remains in PR #28.
const workspace='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
const campaign='44444444-4444-4444-8444-444444444444';
const draft={product_service:'BROS SELL',audience:'SME Malaysia',description:'Brief',problem:'Unclear value',objective:'Educate',duration_days:7,platforms:['facebook']};
async function fixture(run){
 const rows=new Map();
 let writes=0;
 const server=createServer(async(req,res)=>{
  const auth=req.headers.authorization==='Bearer fixture-member';
  const scoped=req.headers['x-workspace-id']===workspace;
  if(!auth||!scoped){res.writeHead(403);res.end(JSON.stringify({error:'forbidden'}));return;}
  if(req.method==='POST'&&req.url==='/draft'){
   let body='';for await(const chunk of req)body+=chunk;
   const parsed=JSON.parse(body);
   const key=req.headers['idempotency-key'];
   if(!key||typeof key!=='string'){res.writeHead(400);res.end();return;}
   const prior=rows.get(key);
   if(prior&&JSON.stringify(prior.brief)!==JSON.stringify(parsed)){res.writeHead(409);res.end();return;}
   if(!prior){rows.set(key,{id:campaign,status:'draft',brief:parsed});writes++;}
   res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({id:campaign}));
   return;
  }
  if(req.method==='GET'&&req.url==='/workspace'){
   const campaigns=[...rows.values()].map(({id,status,brief})=>({id,status,...brief}));
   res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify({data:{workspace:{id:workspace,name:'Fixture'},campaigns,contentItems:[],scenes:[]}}));
   return;
  }
  res.writeHead(404);res.end();
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,method='GET',key,scope=workspace,body=draft)=>fetch(base+path,{method,headers:{authorization:'Bearer fixture-member','x-workspace-id':scope,...(key?{'idempotency-key':key}:{}),...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 try{await run({request,get writes(){return writes;}});}finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
}
test('uncertain HTTP acknowledgement retries with identical key; independent GET verifies one persisted draft',async()=>{
 await fixture(async fx=>{
  let issued=0;const keygen=()=> 'fixture-retry-key-'+(++issued);
  const attempt=prepareContentDraftRetry(null,workspace,draft,keygen);
  const first=await fx.request('/draft','POST',attempt.key);
  assert.equal(first.status,201);
  // Treat first 201 as lost: never infer persistence from the POST receipt.
  const retry=prepareContentDraftRetry(attempt,workspace,structuredClone(draft),keygen);
  assert.strictEqual(retry,attempt);
  assert.equal((await fx.request('/draft','POST',retry.key)).status,201);
  const read=await (await fx.request('/workspace')).json();
  assert.equal(confirmContentDraftReadback(read,workspace,campaign,draft).campaigns.length,1);
  assert.equal(fx.writes,1);assert.equal(issued,1);
 });
});
test('HTTP fixture denies cross-workspace read and fails closed on missing persisted readback',async()=>{
 await fixture(async fx=>{
  assert.equal((await fx.request('/workspace','GET',null,other)).status,403);
  assert.equal((await fx.request('/workspace','GET',null,workspace)).status,200);
  const empty=await (await fx.request('/workspace')).json();
  assert.throws(()=>confirmContentDraftReadback(empty,workspace,campaign,draft),ContentDraftReadbackUnverified);
  assert.equal(fx.writes,0);
 });
});
test('same idempotency key with changed payload conflicts without overwriting draft',async()=>{
 await fixture(async fx=>{
  const key='fixture-retry-key-conflict';
  assert.equal((await fx.request('/draft','POST',key)).status,201);
  assert.equal((await fx.request('/draft','POST',key,workspace,{...draft,problem:'Changed'})).status,409);
  const read=await (await fx.request('/workspace')).json();
  assert.equal(confirmContentDraftReadback(read,workspace,campaign,draft).campaigns.length,1);
  assert.equal(fx.writes,1);
 });
});
