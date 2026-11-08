import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceIndexGet} from '../lib/content/neon-content-workspace-index-http.ts';
import {createContentWorkspaceGet} from '../lib/content/neon-content-workspace-http.ts';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';
import {parseContentWorkspaceIndex} from '../lib/content/neon-content-workspace-index-response.ts';
import {parseContentWorkspaceDetail} from '../lib/content/neon-content-workspace-detail-response.ts';
import {parseContentDraftAcknowledgement} from '../lib/content/neon-content-draft-ack-response.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';

const user='11111111-1111-4111-8111-111111111111';
const foreign='22222222-2222-4222-8222-222222222222';
const workspace='33333333-3333-4333-8333-333333333333';
const campaign='44444444-4444-4444-8444-444444444444';
const endpoint='https://content.example.test';
const principal=Object.freeze({userId:user,authenticated:true});
const verify=async request=>request.headers.get('x-test-session')==='valid'?principal:null;
const get=(path,session='valid')=>new Request(endpoint+path,{headers:{'x-test-session':session}});
const payload={product_service:'BROS SELL',audience:'Malaysian sellers',description:'Education',problem:'Unclear value',objective:'Explain',duration_days:7,platforms:['facebook']};
const post=(id=workspace,session='valid',key='fixed-test-key-123456')=>new Request(endpoint+'/api/content/dev/workspaces/'+id+'/campaign-drafts',{
 method:'POST',headers:{'x-test-session':session,'origin':endpoint,'sec-fetch-site':'same-origin','content-type':'application/json','idempotency-key':key},
 body:JSON.stringify(payload)
});
function harness(){
 const records=new Map();let writes=0;let reads=0;
 const authorize=(p,id)=>{if(p.userId!==user||id!==workspace)throw new ContentReadDenied();};
 const list=createContentWorkspaceIndexGet(verify,async p=>({workspaces:p.userId===user?[{id:workspace,name:'Recovered DEV'}]:[]}));
 const save=createContentCampaignDraftPost(verify,async(p,id,draft,key)=>{
  authorize(p,id);const identity=id+'|'+key;
  if(!records.has(identity)){writes++;records.set(identity,{id:campaign,workspace_id:id,status:'draft',...draft});}
  return {id:campaign,status:'draft'};
 });
 const read=createContentWorkspaceGet(verify,async(p,id)=>{
  authorize(p,id);reads++;
  return {workspace:{id:workspace,name:'Recovered DEV'},campaigns:[...records.values()],
   contentItems:[],scenes:[]};
 });
 return {list,save,read,counts:()=>({writes,reads})};
}
test('verified session: workspace discovery, draft write, replay, strict readback',async()=>{
 const h=harness();
 const index=await h.list(get('/api/content/dev/workspaces'));
 assert.equal(index.status,200);
 assert.equal(index.headers.get('cache-control'),'no-store');
 assert.equal(parseContentWorkspaceIndex(await index.json())[0].id,workspace);
 const saved=await h.save(post(),workspace);
 assert.equal(saved.status,201);
 assert.equal(parseContentDraftAcknowledgement(await saved.json(),saved.status).status,'draft');
 const replay=await h.save(post());
 assert.equal(replay.status,201);
 assert.equal(h.counts().writes,1,'idempotent replay must not duplicate a draft');
 const result=await h.read(get('/api/content/dev/workspaces/'+workspace),workspace);
 assert.equal(result.status,200);
 const detail=parseContentWorkspaceDetail(await result.json(),workspace);
 assert.equal(detail.campaigns.length,1);
 assert.equal(detail.campaigns[0].product_service,payload.product_service);
 assert.equal(h.counts().reads,1);
});
test('missing session denies discovery, draft creation and read without side effects',async()=>{
 const h=harness();
 assert.equal((await h.list(get('/api/content/dev/workspaces','none'))).status,401);
 assert.equal((await h.save(post(workspace,'none'),workspace)).status,401);
 assert.equal((await h.read(get('/api/content/dev/workspaces/'+workspace,'none'),workspace)).status,401);
 assert.deepEqual(h.counts(),{writes:0,reads:0});
});
test('foreign workspace denies writes and reads without data disclosure',async()=>{
 const h=harness();
 assert.equal((await h.save(post(foreign),foreign)).status,404);
 assert.equal((await h.read(get('/api/content/dev/workspaces/'+foreign),foreign)).status,404);
 assert.deepEqual(h.counts(),{writes:0,reads:0});
});
test('cross-origin draft POST rejected before writer invocation',async()=>{
 const h=harness();
 const req=post();
 req.headers.set('origin','https://attacker.example');
 assert.equal((await h.save(req,workspace)).status,403);
 assert.equal(h.counts().writes,0);
});
