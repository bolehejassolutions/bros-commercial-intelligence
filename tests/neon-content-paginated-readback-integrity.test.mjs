import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceReader} from '../lib/content/neon-content-workspace-reader.ts';

const user='11111111-1111-4111-8111-111111111111';
const workspace='33333333-3333-4333-8333-333333333333';
const tenant='44444444-4444-4444-8444-444444444444';
const campaign='55555555-5555-4555-8555-555555555555';
const item='66666666-6666-4666-8666-666666666666';
const scene='77777777-7777-4777-8777-777777777777';

function readerFor({campaigns=[{id:campaign}],items=[],scenes=[]}) {
 return createContentWorkspaceReader(async fn=>fn(async(sql,params)=>{
  if(sql.includes('FROM pg_roles'))return {rows:[{name:'content_dev_reader_v2',login:'content_dev_reader_v2',can_login:true,inherits:false,bypass:false,superuser:false,can_create_role:false,parents:0}]};
  if(sql.includes('current_database()'))return {rows:[{db:'bros_intelligence_dev',forced:4,staging:false,credits:false,writes:false,membership:true}]};
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:user}]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:workspace,tenant_id:tenant}]};
  if(sql.includes('FROM content_dev.campaigns')){assert.deepEqual(params,[tenant,workspace,user]);return {rows:campaigns};}
  if(sql.includes('FROM content_dev.content_items'))return {rows:items};
  if(sql.includes('FROM content_dev.scenes'))return {rows:scenes};
  throw new Error('Unexpected query');
 }));
}
const read=reader=>reader({userId:user,authenticated:true},workspace);

test('paginated readback restores unambiguous campaign items and scenes',async()=>{
 const result=await read(readerFor({items:[{id:item,campaign_id:campaign}],scenes:[{id:scene,content_item_id:item}]}));
 assert.equal(result.campaigns.length,1);
 assert.equal(result.contentItems[0].id,item);
 assert.equal(result.scenes[0].id,scene);
});
test('paginated readback rejects repeated campaign IDs',async()=>{
 await assert.rejects(read(readerFor({campaigns:[{id:campaign},{id:campaign}]})),/CONTENT access denied/);
});
test('paginated readback rejects repeated content item IDs',async()=>{
 await assert.rejects(read(readerFor({items:[{id:item,campaign_id:campaign},{id:item,campaign_id:campaign}]})),/CONTENT access denied/);
});
test('paginated readback rejects repeated scene IDs',async()=>{
 await assert.rejects(read(readerFor({items:[{id:item,campaign_id:campaign}],scenes:[{id:scene,content_item_id:item},{id:scene,content_item_id:item}]})),/CONTENT access denied/);
});
