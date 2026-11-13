import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceReader} from '../lib/content/neon-content-workspace-reader.ts';

const user='11111111-1111-4111-8111-111111111111';
const workspace='33333333-3333-4333-8333-333333333333';
const tenant='44444444-4444-4444-8444-444444444444';
const receipt='55555555-5555-4555-8555-555555555555';

test('receipt-specific draft readback preserves all campaign strategy and publishing fields',async()=>{
 const campaign={id:receipt,status:'draft',product_service:'Example',description:'Description',
  audience:'SME',problem:'Slow replies',objective:'Clarity',duration_days:7,platforms:['tiktok'],
  strategy:{goal:'educate'},angles:[{hook:'Question'}],captions:[{text:'Example'}],
  publish_plan:{state:'draft'},created_at:'2026-11-13T00:00:00Z',updated_at:'2026-11-13T01:00:00Z'};
 let selectedSQL='';
 const reader=createContentWorkspaceReader(async fn=>fn(async(sql,params)=>{
  if(sql.includes('FROM pg_roles'))return {rows:[{name:'content_dev_reader_v2',login:'content_dev_reader_v2',can_login:true,inherits:false,bypass:false,superuser:false,can_create_role:false,parents:0}]};
  if(sql.includes('current_database()'))return {rows:[{db:'bros_intelligence_dev',forced:4,staging:false,credits:false,writes:false,membership:true}]};
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:user}]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:workspace,tenant_id:tenant,name:'Test'}]};
  if(sql.includes('FROM content_dev.campaigns')){
   selectedSQL=sql;
   assert.deepEqual(params,[tenant,workspace,user,receipt]);
   return {rows:[campaign]};
  }
  if(sql.includes('FROM content_dev.content_items'))return {rows:[]};
  throw new Error('Unexpected query');
 }));
 const result=await reader({userId:user,authenticated:true},workspace,undefined,receipt);
 for(const field of ['strategy','angles','captions','publish_plan','created_at','updated_at'])
  assert.match(selectedSQL,new RegExp('\\b'+field+'\\b'));
 assert.deepEqual(result.campaigns,[campaign]);
 assert.deepEqual(result.contentItems,[]);
 assert.deepEqual(result.scenes,[]);
 assert.equal(result.nextCursor,null);
});

test('receipt readback restores scoped content items and scenes with bounded queries',async()=>{
 const item='66666666-6666-4666-8666-666666666666';
 const scene='77777777-7777-4777-8777-777777777777';
 const seen=[];
 const reader=createContentWorkspaceReader(async fn=>fn(async(sql,params)=>{
  if(sql.includes('FROM pg_roles'))return {rows:[{name:'content_dev_reader_v2',login:'content_dev_reader_v2',can_login:true,inherits:false,bypass:false,superuser:false,can_create_role:false,parents:0}]};
  if(sql.includes('current_database()'))return {rows:[{db:'bros_intelligence_dev',forced:4,staging:false,credits:false,writes:false,membership:true}]};
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:user}]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:workspace,tenant_id:tenant}]};
  if(sql.includes('FROM content_dev.campaigns'))return {rows:[{id:receipt,status:'draft'}]};
  if(sql.includes('FROM content_dev.content_items')){
   assert.deepEqual(params,[tenant,receipt]);assert.match(sql,/LIMIT 501/);
   seen.push('items');return {rows:[{id:item,campaign_id:receipt,type:'script',body:'Fixture'}]};
  }
  if(sql.includes('FROM content_dev.scenes')){
   assert.deepEqual(params,[tenant,item]);assert.match(sql,/LIMIT [0-9]+/);
   seen.push('scenes');return {rows:[{id:scene,content_item_id:item,visual_prompt:'Fixture prompt'}]};
  }
  throw new Error('Unexpected query');
 }));
 const result=await reader({userId:user,authenticated:true},workspace,undefined,receipt);
 assert.deepEqual(seen,['items','scenes']);
 assert.equal(result.contentItems[0].id,item);
 assert.equal(result.scenes[0].id,scene);
 assert.equal(result.nextCursor,null);
});

test('receipt readback fails closed when child campaign scope mismatches',async()=>{
 const reader=createContentWorkspaceReader(async fn=>fn(async(sql)=>{
  if(sql.includes('FROM pg_roles'))return {rows:[{name:'content_dev_reader_v2',login:'content_dev_reader_v2',can_login:true,inherits:false,bypass:false,superuser:false,can_create_role:false,parents:0}]};
  if(sql.includes('current_database()'))return {rows:[{db:'bros_intelligence_dev',forced:4,staging:false,credits:false,writes:false,membership:true}]};
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:user}]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:workspace,tenant_id:tenant}]};
  if(sql.includes('FROM content_dev.campaigns'))return {rows:[{id:receipt,status:'draft'}]};
  if(sql.includes('FROM content_dev.content_items'))return {rows:[{id:'66666666-6666-4666-8666-666666666666',campaign_id:workspace}]};
  throw new Error('Unexpected query');
 }));
 await assert.rejects(reader({userId:user,authenticated:true},workspace,undefined,receipt),/CONTENT access denied/);
});
