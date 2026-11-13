import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceReader} from '../lib/content/neon-content-workspace-reader.ts';
const user='11111111-1111-4111-8111-111111111111';
const workspace='33333333-3333-4333-8333-333333333333';
const tenant='44444444-4444-4444-8444-444444444444';
const campaigns=['55555555-5555-4555-8555-555555555555','88888888-8888-4888-8888-888888888888'];
const shared='66666666-6666-4666-8666-666666666666';
const scenes=['77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999'];
function makeReader(duplicate: 'item'|'scene'|null) {
 return createContentWorkspaceReader(async fn=>fn(async(sql,params)=>{
  if(sql.includes('FROM pg_roles'))return {rows:[{name:'content_dev_reader_v2',login:'content_dev_reader_v2',can_login:true,inherits:false,bypass:false,superuser:false,can_create_role:false,parents:0}]};
  if(sql.includes('current_database()'))return {rows:[{db:'bros_intelligence_dev',forced:4,staging:false,credits:false,writes:false,membership:true}]};
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:user}]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:workspace,tenant_id:tenant}]};
  if(sql.includes('FROM content_dev.campaigns'))return {rows:campaigns.map(id=>({id}))};
  if(sql.includes('FROM content_dev.content_items')){
   const index=campaigns.indexOf(String(params[1]));
   return {rows:[{id:duplicate==='item'?shared:scenes[index],campaign_id:campaigns[index]}]};
  }
  if(sql.includes('FROM content_dev.scenes')){
   const index=duplicate==='item'?0:scenes.indexOf(String(params[1]));
   return {rows:[{id:duplicate==='scene'?shared:scenes[index],content_item_id:String(params[1])}]};
  }
  throw new Error('Unexpected query');
 }));
}
test('paginated reader accepts distinct items and scenes across campaigns',async()=>{
 const result=await makeReader(null)({userId:user,authenticated:true},workspace);
 assert.equal(result.campaigns.length,2);
 assert.equal(result.contentItems.length,2);
 assert.equal(result.scenes.length,2);
});
test('paginated reader denies same item ID across campaigns',async()=>{
 await assert.rejects(makeReader('item')({userId:user,authenticated:true},workspace),/CONTENT access denied/);
});
test('paginated reader denies same scene ID across different items',async()=>{
 await assert.rejects(makeReader('scene')({userId:user,authenticated:true},workspace),/CONTENT access denied/);
});
