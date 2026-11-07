import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentWorkspaceReader, ContentReadDenied } from '../lib/content/neon-content-workspace-reader.ts';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const W='33333333-3333-4333-8333-333333333333';
const T='44444444-4444-4444-8444-444444444444';
const C='55555555-5555-4555-8555-555555555555';
const I='66666666-6666-4666-8666-666666666666';
const role={name:'content_dev_reader_v2',login:'content_dev_reader_v2',can_login:true,inherits:false,bypass:false,superuser:false,can_create_role:false,parents:0};
const posture={db:'bros_intelligence_dev',forced:4,staging:false,credits:false,writes:false,membership:true};
function mock({owner=A,roleRow=role,postureRow=posture,contextPrincipal=A}={}) {
  const calls=[];
  const reader=createContentWorkspaceReader(async fn=>fn(async (sql,params)=>{
    calls.push({sql,params});
    if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:contextPrincipal}]};
    if(sql.includes('FROM pg_roles'))return {rows:[roleRow]};
    if(sql.includes('current_database()'))return {rows:[postureRow]};
    if(sql.includes('FROM content_dev.workspaces'))return {rows:params[0]===owner?[{id:W,tenant_id:T,name:'Legacy',business_dna:{}}]:[]};
    if(sql.includes('FROM content_dev.campaigns'))return {rows:[{id:C,tenant_id:T,workspace_id:W,owner_principal_id:A}]};
    if(sql.includes('FROM content_dev.content_items'))return {rows:[{id:I,tenant_id:T,campaign_id:C}]};
    if(sql.includes('FROM content_dev.scenes'))return {rows:[{id:'77777777-7777-4777-8777-777777777777',tenant_id:T,content_item_id:I}]};
    throw Error('unexpected SQL');
  }));
  return {reader,calls};
}
test('verified owner can read scoped original campaigns, content and scenes',async()=>{
  const {reader,calls}=mock();
  const result=await reader({userId:A,authenticated:true},W);
  assert.equal(result.campaigns.length,1);
  assert.equal(result.contentItems.length,1);
  assert.equal(result.scenes.length,1);
  assert.deepEqual(calls.at(-1).params,[T,I]);
});
test('foreign principal cannot read workspace or its campaigns',async()=>{
  const {reader,calls}=mock();
  await assert.rejects(reader({userId:B,authenticated:true},W),ContentReadDenied);
  assert.equal(calls.some(c=>c.sql.includes('FROM content_dev.campaigns')),false);
});
test('unauthenticated, invalid IDs fail before database access',async()=>{
  const {reader,calls}=mock();
  await assert.rejects(reader({userId:A,authenticated:false},W),ContentReadDenied);
  await assert.rejects(reader({userId:A,authenticated:true},'not-a-uuid'),ContentReadDenied);
  assert.equal(calls.length,0);
});
test('admin or inherited DB login fails closed',async()=>{
  const {reader,calls}=mock({roleRow:{...role,login:'neondb_owner'}});
  await assert.rejects(reader({userId:A,authenticated:true},W),ContentReadDenied);
  assert.equal(calls.length,1);
});
test('missing forced RLS, staging access or write privilege fails closed',async()=>{
  for(const change of [{forced:3},{staging:true},{writes:true}]){
    const {reader,calls}=mock({postureRow:{...posture,...change}});
    await assert.rejects(reader({userId:A,authenticated:true},W),ContentReadDenied);
    assert.equal(calls.length,2);
  }
});

test('verified principal is set transaction-locally before workspace membership query',async()=>{
 const {reader,calls}=mock();
 await reader({userId:A,authenticated:true},W);
 const context=calls.findIndex(x=>x.sql.includes("set_config('bci.principal_id'"));
 const membership=calls.findIndex(x=>x.sql.includes('FROM content_dev.workspaces'));
 assert.ok(context>=0&&membership>context);
 assert.deepEqual(calls[context].params,[A]);
});

test('identity context mismatch fails closed before workspace query',async()=>{
 const {reader,calls}=mock({contextPrincipal:B});
 await assert.rejects(reader({userId:A,authenticated:true},W),ContentReadDenied);
 assert.equal(calls.some(x=>x.sql.includes('FROM content_dev.workspaces')),false);
});

test('malformed nested campaign ownership fails closed',async()=>{
 const calls=[];
 const reader=createContentWorkspaceReader(async fn=>fn(async(sql,params)=>{
  calls.push(sql);
  if(sql.includes('FROM pg_roles'))return {rows:[role]};
  if(sql.includes('current_database()'))return {rows:[posture]};
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:A}]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:W,tenant_id:T}]};
  if(sql.includes('FROM content_dev.campaigns'))return {rows:[{id:C,tenant_id:T,workspace_id:W,owner_principal_id:A}]};
  if(sql.includes('FROM content_dev.content_items'))return {rows:[{id:I,tenant_id:T,campaign_id:B}]};
  throw Error('unexpected query');
 }));
 await assert.rejects(reader({userId:A,authenticated:true},W),ContentReadDenied);
 assert.equal(calls.some(sql=>sql.includes('FROM content_dev.scenes')),false);
});

test('rejects campaign rows inconsistent with verified tenant, workspace or owner',async()=>{
 for(const field of ['tenant_id','workspace_id','owner_principal_id']){
  let nested=0;
  const reader=createContentWorkspaceReader(async fn=>fn(async(sql)=>{
   if(sql.includes('FROM pg_roles'))return {rows:[role]};
   if(sql.includes('current_database()'))return {rows:[posture]};
   if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:A}]};
   if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:W,tenant_id:T}]};
   if(sql.includes('FROM content_dev.campaigns'))return {rows:[{id:C,tenant_id:T,workspace_id:W,owner_principal_id:A,[field]:B}]};
   nested++;return {rows:[]};
  }));
  await assert.rejects(reader({userId:A,authenticated:true},W),ContentReadDenied);
  assert.equal(nested,0);
 }
});
test('rejects silently truncated campaign history at the read cap',async()=>{
 const reader=createContentWorkspaceReader(async fn=>fn(async(sql)=>{
  if(sql.includes('FROM pg_roles'))return {rows:[role]};
  if(sql.includes('current_database()'))return {rows:[posture]};
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:A}]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:W,tenant_id:T}]};
  if(sql.includes('FROM content_dev.campaigns'))return {rows:Array.from({length:101},()=>({id:C,tenant_id:T,workspace_id:W,owner_principal_id:A}))};
  throw Error('nested read must not occur');
 }));
 await assert.rejects(reader({userId:A,authenticated:true},W),ContentReadDenied);
});

test('rejects nested content or scenes whose returned tenant differs from authenticated workspace',async()=>{
 for(const corrupt of ['content','scene']){
  const calls=[];
  const reader=createContentWorkspaceReader(async fn=>fn(async(sql)=>{
   calls.push(sql);
   if(sql.includes('FROM pg_roles'))return {rows:[role]};
   if(sql.includes('current_database()'))return {rows:[posture]};
   if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:A}]};
   if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:W,tenant_id:T}]};
   if(sql.includes('FROM content_dev.campaigns'))return {rows:[{id:C,tenant_id:T,workspace_id:W,owner_principal_id:A}]};
   if(sql.includes('FROM content_dev.content_items'))return {rows:[{id:I,tenant_id:corrupt==='content'?B:T,campaign_id:C}]};
   if(sql.includes('FROM content_dev.scenes'))return {rows:[{id:'77777777-7777-4777-8777-777777777777',tenant_id:B,content_item_id:I}]};
   throw Error('unexpected query');
  }));
  await assert.rejects(reader({userId:A,authenticated:true},W),ContentReadDenied);
  if(corrupt==='content')assert.equal(calls.some(sql=>sql.includes('FROM content_dev.scenes')),false);
 }
});
