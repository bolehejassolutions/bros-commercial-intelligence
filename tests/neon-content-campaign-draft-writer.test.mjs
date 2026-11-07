import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftWriter} from '../lib/content/neon-content-campaign-draft-writer.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';

const A='11111111-1111-4111-8111-111111111111';
const W='22222222-2222-4222-8222-222222222222';
const T='33333333-3333-4333-8333-333333333333';
const C='44444444-4444-4444-8444-444444444444';
const principal={userId:A,authenticated:true};
const draft={product_service:'Example',audience:'Owners',description:'',problem:'',objective:'',duration_days:7,platforms:[]};
const key='safe_retry_key_123';
const role={name:'content_dev_draft_writer',login:'content_dev_draft_writer',can_login:true,inherits:false,bypass:false,superuser:false,parents:0};
const posture={db:'bros_intelligence_dev',forced:2,staging:false,credits:false,jobs:false,writes:true,membership:true};
function fixture({foreign=false,roleRow=role,postureRow=posture,insert=[],existing=[]}={}){
 const calls=[];
 const writer=createContentCampaignDraftWriter(async fn=>fn(async(sql,params)=>{
  calls.push({sql,params});
  if(sql.includes('FROM pg_roles'))return {rows:[roleRow]};
  if(sql.includes('current_database()'))return {rows:[postureRow]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:foreign?[]:[{tenant_id:T}]};
  if(sql.includes('to_regclass'))return {rows:[{table_name:'content_dev.campaign_draft_requests',can_insert:true}]};
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[{lock_result:null}]};
  if(sql.includes('WITH reservation AS'))return {rows:insert};
  if(sql.includes('SELECT r.campaign_id'))return {rows:existing};
  throw Error('Unexpected SQL');
 }));
 return {writer,calls};
}
test('new draft returns persisted ID with verified owner scope',async()=>{
 const {writer,calls}=fixture({insert:[{id:C}]});
 assert.deepEqual(await writer(principal,W,draft,key),{id:C,status:'draft'});
 assert.deepEqual(calls.at(-1).params.slice(0,4),[T,A,key,W]);
});
test('foreign workspace denies before any reservation or campaign insert',async()=>{
 const {writer,calls}=fixture({foreign:true});
 await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
 assert.equal(calls.some(x=>x.sql.includes('WITH reservation AS')),false);
});
test('replay checks JSONB equality in SQL, not JS property order',async()=>{
 const {writer,calls}=fixture({existing:[{campaign_id:C,same_request:true,valid_campaign:true}]});
 assert.deepEqual(await writer(principal,W,draft,key),{id:C,status:'draft',replayed:true});
 assert.match(calls.at(-1).sql,/r\.payload=\$5::jsonb/);
});
test('mismatched replay or stale campaign link fails closed',async()=>{
 for(const row of [{campaign_id:C,same_request:false,valid_campaign:true},{campaign_id:C,same_request:true,valid_campaign:false}]){
  const {writer}=fixture({existing:[row]});
  await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
 }
});
test('unsafe database privileges or inherited role deny writes',async()=>{
 for(const config of [{roleRow:{...role,inherits:true}},{postureRow:{...posture,credits:true}},{postureRow:{...posture,forced:1}}]){
  const {writer,calls}=fixture(config);
  await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
  assert.equal(calls.some(x=>x.sql.includes('WITH reservation AS')),false);
 }
});

test('idempotency lock is acquired before mutation using tenant, principal and key',async()=>{
 const {writer,calls}=fixture({insert:[{id:C}]});
 await writer(principal,W,draft,key);
 const lockIndex=calls.findIndex(x=>x.sql.includes('pg_advisory_xact_lock'));
 const insertIndex=calls.findIndex(x=>x.sql.includes('WITH reservation AS'));
 assert.ok(lockIndex>=0&&insertIndex>lockIndex);
 assert.deepEqual(calls[lockIndex].params,[T+':'+A+':'+key]);
 assert.match(calls[lockIndex].sql,/pg_advisory_xact_lock/);
});

test('void-returning advisory lock succeeds on one returned row, without boolean coercion',async()=>{
 const {writer,calls}=fixture({insert:[{id:C}]});
 assert.deepEqual(await writer(principal,W,draft,key),{id:C,status:'draft'});
 const lockCall=calls.find(x=>x.sql.includes('pg_advisory_xact_lock'));
 assert.match(lockCall.sql,/AS lock_result/);
 assert.doesNotMatch(lockCall.sql,/IS NULL AS acquired/);
});
