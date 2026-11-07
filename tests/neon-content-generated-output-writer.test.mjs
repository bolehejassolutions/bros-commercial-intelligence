import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentGeneratedOutputWriter} from '../lib/content/neon-content-generated-output-writer.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';
import {ContentGenerationRejected} from '../lib/content/neon-content-generation-contract.ts';

const OWNER='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const FOREIGN='11111111-1111-4111-8111-111111111111';
const WORKSPACE='22222222-2222-4222-8222-222222222222';
const TENANT='33333333-3333-4333-8333-333333333333';
const CAMPAIGN='44444444-4444-4444-8444-444444444444';
const idFor=i=>'55555555-5555-4555-8555-'+String(i).padStart(12,'0');
const input={product_service:'BROS CONTENT',audience:'Malaysian SME',
 description:'Content planning',problem:'No system',objective:'Educate',duration_days:7,
 platforms:['facebook','tiktok']};
const plan={
 strategy:{positioning:'Practical',core_message:'Operating rhythm',offer_angle:'System',
  platform_strategy:['Facebook','TikTok']},
 angles:[{title:'Hook',hook:'No content?',reason:'No process'}],
 scripts:[{title:'Script one',hook:'Start here',body:'Use a system',cta:'Save'}],
 scenes:[{scene_number:1,duration_seconds:6,visual_prompt:'A planning desk',
  motion_prompt:'Pan',narration:'One step',dialogue:''}],
 visuals:[{title:'Poster',prompt:'A realistic planning board'}],
 captions:[{platform:'facebook',caption:'Educational insight'}],
 publish_plan:[{day:1,platform:'facebook',content_type:'post',objective:'Awareness'}]
};
const qc={pass:true,score:85,issues:[],fixes:[]};
const KEY='generation-job-20261107';
function makeDb({role='content_dev_generated_writer_v1',postureOk=true,
 owner=OWNER,failAt='',initial=null}={}){
 let committed=initial??{request:null,campaign:null,items:[],scenes:[]};
 const calls=[];let connections=0,commits=0,rollbacks=0;
 const transaction=async operation=>{
  connections++;
  const local=structuredClone(committed);
  let itemIndex=local.items.length;
  let sceneIndex=local.scenes.length;
  try{
   const result=await operation(async(sql,params=[])=>{
    calls.push({sql,params});
    if(failAt&&sql.includes(failAt))throw new Error('SENSITIVE DB DETAIL');
    if(sql.includes('FROM pg_roles WHERE rolname=current_user'))return {rows:[{
     name:role,login:role,can_login:true,inherits:false,bypass:false,
     superuser:false,can_create_role:false,parents:0
    }]};
    if(sql.includes('current_database() AS db'))return {rows:[{
     db:'bros_intelligence_dev',forced:postureOk?5:4,
     request_table:'content_dev.generated_output_requests',
     membership:true,workspace_read:true,campaigns_insert:true,campaigns_update:false,
     items_insert:true,scenes_insert:true,request_insert:true,
     request_read:true,request_update:true,fingerprint_update:false,jobs_insert:false,credits_insert:false,staging:false
    }]};
    if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:params[0]}]};
    if(sql.includes('FROM content_dev.workspaces w'))return {rows:params[0]===owner?
     [{tenant_id:TENANT}]:[]};
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[{lock_result:null}]};
    if(sql.includes('SELECT r.workspace_id,r.fingerprint'))return {rows:local.request?
     [{...local.request,status:'draft',tenant_id:TENANT,owner_principal_id:owner}]:[]};
    if(sql.includes('FROM content_dev.campaigns')&&sql.includes('SELECT product_service'))
     return {rows:local.campaign?[local.campaign]:[]};
    if(sql.includes('SELECT id,type,title,body,sort_order,version'))
     return {rows:local.items};
    if(sql.includes('SELECT s.content_item_id,'))
     return {rows:local.scenes};
    if(sql.includes('INSERT INTO content_dev.generated_output_requests')){
     if(local.request)return {rows:[]};
     local.request={tenant_id:params[0],owner_principal_id:params[1],
      workspace_id:params[2],idempotency_key:params[3],fingerprint:params[4],
      expected_items:params[5],expected_scenes:params[6],campaign_id:null};
     return {rows:[{idempotency_key:params[3]}]};
    }
    if(sql.includes('INSERT INTO content_dev.campaigns')){
     local.campaign={id:CAMPAIGN,tenant_id:params[0],owner_principal_id:params[2],
      workspace_id:params[1],status:'draft',product_service:params[3],description:params[4],
      audience:params[5],problem:params[6],objective:params[7],duration_days:params[8],
      platforms:params[9],strategy:JSON.parse(params[10]),angles:JSON.parse(params[11]),
      captions:JSON.parse(params[12]),publish_plan:JSON.parse(params[13])};return {rows:[{id:CAMPAIGN}]};
    }
    if(sql.includes('INSERT INTO content_dev.content_items')){
     itemIndex++;
     const id=idFor(itemIndex);
     local.items.push({id,tenant_id:params[0],campaign_id:params[1],type:params[2],
      title:params[3],body:JSON.parse(params[4]),sort_order:params[5],version:params[6]});
     return {rows:[{id}]};
    }
    if(sql.includes('INSERT INTO content_dev.scenes')){
     sceneIndex++;
     const id=idFor(100+sceneIndex);
     local.scenes.push({id,tenant_id:params[0],content_item_id:params[1],
      scene_number:params[2],duration_seconds:String(params[3]),narration:params[4],
      dialogue:params[5],visual_prompt:params[6],motion_prompt:params[7],
      continuity_lock:JSON.parse(params[8])});
     return {rows:[{id}]};
    }
    if(sql.includes('UPDATE content_dev.generated_output_requests')){
     if(!local.request||local.request.campaign_id)throw new Error('Bad state');
     local.request.campaign_id=params[3];return {rows:[{campaign_id:params[3]}]};
    }
    if(sql.includes('SELECT\n      (SELECT count(*)::int FROM content_dev.content_items'))
     return {rows:[{items:local.items.length,scenes:local.scenes.length}]};
    throw new Error('Unexpected SQL: '+sql.slice(0,120));
   });
   committed=local;commits++;return result;
  }catch(e){rollbacks++;throw e;}
 };
 const write=createContentGeneratedOutputWriter(transaction);
 return {write,calls,stat:()=>({committed,connections,commits,rollbacks})};
}
const args=(principal=OWNER,key=KEY)=>[
 {userId:principal,authenticated:true},WORKSPACE,key,input,plan,qc
];

test('atomic save stores one draft campaign, two output items and one scene under verified tenant',async()=>{
 const db=makeDb();
 const result=await db.write(...args());
 assert.deepEqual(result,{id:CAMPAIGN,status:'draft',replayed:false});
 const s=db.stat();
 assert.equal(s.commits,1);assert.equal(s.rollbacks,0);
 assert.equal(s.committed.items.length,3); // script + visual + scenes manifest
 assert.equal(s.committed.scenes.length,1);
 assert.equal(s.committed.request.campaign_id,CAMPAIGN);
 const all=db.calls.map(c=>c.sql).join('\n');
 assert.match(all,/pg_advisory_xact_lock/);
 assert.match(all,/ON CONFLICT \(tenant_id,owner_principal_id,idempotency_key\)/);
 assert.match(all,/set_config\('bci.principal_id'/);
 assert.match(all,/m.product='content'/);
 assert.match(all,/m.revoked_at IS NULL/);
 assert.ok(db.calls.filter(c=>c.sql.includes('INSERT INTO content_dev.content_items')).every(c=>c.params[0]===TENANT));
 assert.ok(db.calls.filter(c=>c.sql.includes('INSERT INTO content_dev.scenes')).every(c=>c.params[0]===TENANT));
 assert.doesNotMatch(all,/INSERT INTO content_dev.credit_ledger|INSERT INTO content_dev.generation_jobs/);
});
test('same key and fingerprint replays without a second campaign or new content rows',async()=>{
 const db=makeDb();
 await db.write(...args());
 const inserts=db.calls.filter(c=>c.sql.includes('INSERT INTO')).length;
 const again=await db.write(...args());
 assert.deepEqual(again,{id:CAMPAIGN,status:'draft',replayed:true});
 assert.equal(db.stat().committed.items.length,3);
 assert.equal(db.stat().committed.scenes.length,1);
 assert.equal(db.calls.filter(c=>c.sql.includes('INSERT INTO')).length,inserts);
 assert.equal(db.stat().commits,2);
});
test('unchanged counts but altered stored script body or campaign captions refuse replay',async()=>{
 const db=makeDb();
 await db.write(...args());
 const stored=db.stat().committed;
 const oldBody=structuredClone(stored.items[0].body);
 stored.items[0].body={...oldBody,body:'Tampered copy'};
 await assert.rejects(db.write(...args()),ContentReadDenied);
 stored.items[0].body=oldBody;
 const oldCaptions=structuredClone(stored.campaign.captions);
 stored.campaign.captions={facebook:'Wrong message'};
 await assert.rejects(db.write(...args()),ContentReadDenied);
 stored.campaign.captions=oldCaptions;
 assert.deepEqual(await db.write(...args()),{id:CAMPAIGN,status:'draft',replayed:true});
});
test('stored scene tampering cannot replay even if scene count stays unchanged',async()=>{
 const db=makeDb();
 await db.write(...args());
 const stored=db.stat().committed;
 stored.scenes[0].visual_prompt='Unexpected modification';
 await assert.rejects(db.write(...args()),ContentReadDenied);
});
test('reused key with a changed payload is rejected and leaves committed campaign unchanged',async()=>{
 const db=makeDb();
 await db.write(...args());
 const before=JSON.stringify(db.stat().committed);
 await assert.rejects(db.write({userId:OWNER,authenticated:true},WORKSPACE,KEY,
  {...input,product_service:'Tampered product'},plan,qc),ContentReadDenied);
 assert.equal(JSON.stringify(db.stat().committed),before);
 assert.equal(db.stat().rollbacks,1);
});
test('reused key with changed QC evidence is rejected despite identical plan',async()=>{
 const db=makeDb();
 await db.write(...args());
 const before=JSON.stringify(db.stat().committed);
 await assert.rejects(db.write({userId:OWNER,authenticated:true},WORKSPACE,KEY,
  input,plan,{...qc,score:89}),ContentReadDenied);
 assert.equal(JSON.stringify(db.stat().committed),before);
});
test('wrong login, missing RLS and foreign principal all deny BEFORE campaign inserts',async()=>{
 for(const opts of [{role:'neondb_owner'},{role:'content_dev_draft_writer_v2'},
                    {postureOk:false},{owner:FOREIGN}]){
  const db=makeDb(opts);
  await assert.rejects(db.write(...args()),ContentReadDenied);
  assert.equal(db.stat().committed.campaign,null);
  assert.ok(!db.calls.some(c=>c.sql.includes('INSERT INTO content_dev.campaigns')));
 }
});
test('scene failure rolls back reservation, campaign and earlier items together',async()=>{
 const db=makeDb({failAt:'INSERT INTO content_dev.scenes'});
 await assert.rejects(db.write(...args()),/SENSITIVE DB DETAIL/);
 const s=db.stat();
 assert.equal(s.commits,0);assert.equal(s.rollbacks,1);
 assert.equal(s.committed.request,null);
 assert.equal(s.committed.campaign,null);
 assert.equal(s.committed.items.length,0);
 assert.equal(s.committed.scenes.length,0);
});
test('unverified principal, invalid key and low QC reject without acquiring connection',async()=>{
 const db=makeDb();
 await assert.rejects(db.write(...args(FOREIGN,'bad')),ContentReadDenied);
 await assert.rejects(db.write({...args()[0],authenticated:false},...args().slice(1)),ContentReadDenied);
 await assert.rejects(db.write({userId:OWNER,authenticated:true},WORKSPACE,KEY,input,plan,
  {...qc,score:12}),ContentGenerationRejected);
 assert.equal(db.stat().connections,0);
});
