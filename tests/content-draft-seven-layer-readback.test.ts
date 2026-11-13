import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceReader} from '../lib/content/neon-content-workspace-reader.ts';

const principal='11111111-1111-4111-8111-111111111111';
const workspace='33333333-3333-4333-8333-333333333333';
const tenant='44444444-4444-4444-8444-444444444444';
const campaign='55555555-5555-4555-8555-000000000001';
const itemA='66666666-6666-4666-8666-000000000001';
const itemB='66666666-6666-4666-8666-000000000002';
const sceneA='77777777-7777-4777-8777-000000000001';
const sceneB='77777777-7777-4777-8777-000000000002';

function fixture(duplicate=false,overflow=false,sceneOverflow=false) {
 const calls:string[]=[];
 const read=createContentWorkspaceReader(async fn=>fn(async(sql,params)=>{
  calls.push(sql);
  if(sql.includes('FROM pg_roles'))return {rows:[{name:'content_dev_reader_v2',login:'content_dev_reader_v2',can_login:true,inherits:false,bypass:false,superuser:false,can_create_role:false,parents:0}]};
  if(sql.includes('current_database()'))return {rows:[{db:'bros_intelligence_dev',forced:4,staging:false,credits:false,writes:false,membership:true}]};
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:principal}]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:workspace,tenant_id:tenant,name:'DEV workspace'}]};
  if(sql.includes('FROM content_dev.campaigns'))return {rows:[{id:campaign,status:'draft',strategy:{goal:'clarity'},angles:[{hook:'recognition'}],captions:['caption'],publish_plan:{state:'preview'}}]};
  if(sql.includes('FROM content_dev.content_items'))return {rows:overflow?Array.from({length:501},(_,i)=>({id:`66666666-6666-4666-8666-${String(i+1).padStart(12,'0')}`,campaign_id:campaign,title:'Draft',body:'Draft body'})):[{id:itemA,campaign_id:campaign,title:'Script',body:'Draft script'},{id:itemB,campaign_id:campaign,title:'Visual prompt',body:'Draft prompt'}]};
  if(sql.includes('FROM content_dev.scenes'))return {rows:sceneOverflow&&params[1]===itemA?Array.from({length:301},(_,i)=>({id:`77777777-7777-4777-8777-${String(i+1).padStart(12,'0')}`,content_item_id:itemA,scene_number:i+1,visual_prompt:'Scene prompt'})):[{id:params[1]===itemA?sceneA:(duplicate?sceneA:sceneB),content_item_id:params[1],visual_prompt:'Scene prompt'}]};
  throw new Error('unexpected query');
 }));
 return {read,calls};
}

test('draft receipt restores strategy, angles, scripts, prompts, scenes, captions and publish preview',async()=>{
 const {read}=fixture();
 const result=await read({userId:principal,authenticated:true},workspace,undefined,campaign);
 assert.equal((result.campaigns[0].strategy as {goal:string}).goal,'clarity');
 assert.equal((result.campaigns[0].angles as {hook:string}[])[0].hook,'recognition');
 assert.equal(result.contentItems[0].body,'Draft script');
 assert.equal(result.contentItems[1].body,'Draft prompt');
 assert.equal(result.scenes.length,2);
 assert.equal((result.campaigns[0].captions as string[])[0],'caption');
 assert.equal((result.campaigns[0].publish_plan as {state:string}).state,'preview');
 assert.equal(result.nextCursor,null);
});

test('draft receipt rejects reused scene identity across content items',async()=>{
 const {read}=fixture(true);
 await assert.rejects(read({userId:principal,authenticated:true},workspace,undefined,campaign),/CONTENT access denied/);
});

test('receipt readback rejects 501 saved items without issuing scene queries or returning partial content',async()=>{
 const {read,calls}=fixture(false,true);
 await assert.rejects(read({userId:principal,authenticated:true},workspace,undefined,campaign),/CONTENT result exceeds supported read limit/);
 assert.equal(calls.filter(sql=>sql.includes('FROM content_dev.scenes')).length,0);
});

test('receipt readback rejects 301 scenes for one item before reading subsequent items',async()=>{
 const {read,calls}=fixture(false,false,true);
 await assert.rejects(read({userId:principal,authenticated:true},workspace,undefined,campaign),/CONTENT result exceeds supported read limit/);
 assert.equal(calls.filter(sql=>sql.includes('FROM content_dev.scenes')).length,1);
});
