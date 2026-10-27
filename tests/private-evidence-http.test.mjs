import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPrivateEvidenceHttpHandler } from '../lib/bci/private-evidence-http.ts';
import { NEON_PREVIEW_BRANCH } from '../lib/bci/neon-preview-handler.ts';

const USER='11111111-1111-4111-8111-111111111111';
const TENANT='22222222-2222-4222-8222-222222222222';
const OTHER='33333333-3333-4333-8333-333333333333';
const ROW={id:'44444444-4444-4444-8444-444444444444',tenantId:TENANT,product:'content',provider:'buffer',providerRecordKey:'post-1',metrics:{views:4}};
const BASE='https://example.test/api/internal/bci/evidence?product=content';
const BEARER={authorization:'Bearer verified.test.token'};
function fixture({ principal={userId:USER,authenticated:true}, grants=[{principalId:USER,tenantId:TENANT,product:'content',active:true}], rows=[ROW], failDb=false }={}) {
 const calls=[];
 const handler=createPrivateEvidenceHttpHandler({
  verifyBearer:async token=>{calls.push(['auth',token]);return principal},
  membershipsFor:async (id,product)=>{calls.push(['membership',id,product]);return grants},
  readRows:async scope=>{calls.push(['read',scope]);if(failDb)throw Error('secret DB error');return rows},
 });
 return {calls, handler, request:(url=BASE,init={})=>handler(new Request(url,{headers:BEARER,...init}))};
}
const previousEnv={VERCEL_ENV:process.env.VERCEL_ENV,VERCEL_GIT_COMMIT_REF:process.env.VERCEL_GIT_COMMIT_REF,BCI_NEON_DEV_PRIVATE_READS:process.env.BCI_NEON_DEV_PRIVATE_READS};
process.env.VERCEL_ENV='preview';process.env.VERCEL_GIT_COMMIT_REF=NEON_PREVIEW_BRANCH;process.env.BCI_NEON_DEV_PRIVATE_READS='enabled';
process.on('exit',()=>{for(const [k,v] of Object.entries(previousEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v}});

test('valid verified bearer and membership return only product-scoped evidence',async()=>{
 const f=fixture();const r=await f.request();assert.equal(r.status,200);
 assert.deepEqual((await r.json()).data,[ROW]);
 assert.deepEqual(f.calls,[['auth','verified.test.token'],['membership',USER,'content'],['read',{tenantId:TENANT,product:'content',limit:25}]]);
 assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('vary'),'Authorization');
 assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('unmounted private HTTP helper denies other Preview branches and production before auth',async()=>{
 const oldEnv=process.env.VERCEL_ENV,oldBranch=process.env.VERCEL_GIT_COMMIT_REF;
 try{
  for(const [environment,branch] of [['preview','main'],['preview','feat/other-preview'],['production',NEON_PREVIEW_BRANCH],['development',NEON_PREVIEW_BRANCH]]){
   process.env.VERCEL_ENV=environment;process.env.VERCEL_GIT_COMMIT_REF=branch;
   const f=fixture();const r=await f.request();assert.equal(r.status,404);
   assert.deepEqual(f.calls,[]);assert.match(r.headers.get('cache-control'),/no-store/);
  }
 }finally{process.env.VERCEL_ENV=oldEnv;process.env.VERCEL_GIT_COMMIT_REF=oldBranch;}
});
test('disabled preview rejects before any authentication or database call',async()=>{
 const f=fixture();const old=process.env.BCI_NEON_DEV_PRIVATE_READS;delete process.env.BCI_NEON_DEV_PRIVATE_READS;
 try{const r=await f.request();assert.equal(r.status,404);assert.deepEqual(f.calls,[])}finally{process.env.BCI_NEON_DEV_PRIVATE_READS=old}
});
test('rejects missing bearer and unverified principal',async()=>{
 const f=fixture();assert.equal((await f.request(BASE,{headers:{}})).status,401);
 const g=fixture({principal:null});assert.equal((await g.request()).status,403);
 assert.equal(g.calls.some(x=>x[0]==='read'),false);
});
test('rejects forged tenant and admin headers before auth',async()=>{
 for(const name of ['x-user-id','x-tenant-id','x-admin','x-product']){
  const f=fixture();assert.equal((await f.request(BASE,{headers:{...BEARER,[name]:OTHER}})).status,400);assert.deepEqual(f.calls,[]);
 }
});
test('rejects tenant and principal in query and duplicate product',async()=>{
 for(const suffix of ['&tenantId='+OTHER,'&userId='+USER,'&product=demand','&limit=1&limit=2','&limit=0','&limit=51','&limit=1.5']){
  const f=fixture();assert.equal((await f.request(BASE+suffix)).status,400);assert.deepEqual(f.calls,[]);
 }
});
test('rejects non-GET methods and wrong path',async()=>{
 const f=fixture();assert.equal((await f.request(BASE,{method:'POST'})).status,405);
 assert.equal((await f.request('https://example.test/api/public/bci/evidence?product=content')).status,400);
 assert.deepEqual(f.calls,[]);
});
test('missing, cross-product, or impersonated membership cannot read',async()=>{
 for(const grants of [[],[{principalId:OTHER,tenantId:TENANT,product:'content',active:true}],[{principalId:USER,tenantId:TENANT,product:'demand',active:true}]]){
  const f=fixture({grants});assert.equal((await f.request()).status,403);assert.equal(f.calls.some(x=>x[0]==='read'),false);
 }
});
test('cross-tenant evidence, cross-product evidence and replay fail entire response',async()=>{
 for(const rows of [[{...ROW,tenantId:OTHER}],[{...ROW,product:'demand'}],[ROW,ROW]]){
  const f=fixture({rows});const r=await f.request();assert.equal(r.status,403);assert.equal(JSON.stringify(await r.json()).includes('post-1'),false);
 }
});
test('database failures do not leak internal errors and are never cached',async()=>{
 const f=fixture({failDb:true});const r=await f.request();assert.equal(r.status,403);
 assert.equal(JSON.stringify(await r.json()).includes('secret DB error'),false);assert.match(r.headers.get('cache-control'),/no-store/);
});

test('server-only composition point shares the exact branch-pinned Preview gate (source-level guard)',()=>{
 const source=readFileSync(new URL('../lib/bci/private-evidence-server.ts',import.meta.url),'utf8');
 assert.match(source,/import \{ isNeonPreviewEnabled \} from ["']\.\/neon-preview-handler["']/);
 assert.match(source,/if \(!isNeonPreviewEnabled\(process\.env\)\)/);
 // The HTTP handler tests above exercise other Preview branches and production.
 // This static guard does not establish authenticated hosted access.
});
