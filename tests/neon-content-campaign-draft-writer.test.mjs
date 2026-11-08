import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftWriter} from '../lib/content/neon-content-campaign-draft-writer.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';

const A='11111111-1111-4111-8111-111111111111';
const W='22222222-2222-4222-8222-222222222222';
const T='33333333-3333-4333-8333-333333333333';
const C='44444444-4444-4444-8444-444444444444';
const principal={userId:A,authenticated:true};
const draft={product_service:'Example',audience:'Owners',description:'Campaign overview',problem:'Low qualified reach',objective:'Build awareness',duration_days:7,platforms:['facebook']};
const key='safe_retry_key_123';
const role={name:'content_dev_draft_writer_v2',login:'content_dev_draft_writer_v2',can_login:true,inherits:false,bypass:false,superuser:false,can_create_role:false,parents:0};
const posture={db:'bros_intelligence_dev',forced:2,staging:false,credits:false,jobs:false,writes:true,membership:true};
function fixture({foreign=false,roleRow=role,postureRow=posture,insert=[],existing=[],contextPrincipal=A,linkSuccess=true}={}){
 const calls=[];
 const writer=createContentCampaignDraftWriter(async fn=>fn(async(sql,params)=>{
  calls.push({sql,params});
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:contextPrincipal}]};
  if(sql.includes('FROM pg_roles'))return {rows:[roleRow]};
  if(sql.includes('current_database()'))return {rows:[postureRow]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:foreign?[]:[{tenant_id:T}]};
  if(sql.includes('to_regclass'))return {rows:[{table_name:'content_dev.campaign_draft_requests',can_insert:true}]};
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[{lock_result:null}]};
  if(sql.includes('INSERT INTO content_dev.campaign_draft_requests'))return {rows:insert.length?[{idempotency_key:key}]:[]};
  if(sql.includes('INSERT INTO content_dev.campaigns'))return {rows:insert};
  if(sql.includes('UPDATE content_dev.campaign_draft_requests'))return {rows:insert.length&&linkSuccess?[{campaign_id:C}]:[]};
  if(sql.includes('SELECT r.campaign_id'))return {rows:existing};
  throw Error('Unexpected SQL');
 }));
 return {writer,calls};
}
test('new draft returns persisted ID with verified owner scope',async()=>{
 const {writer,calls}=fixture({insert:[{id:C}]});
 assert.deepEqual(await writer(principal,W,draft,key),{id:C,status:'draft'});
 assert.deepEqual(calls.find(x=>x.sql.includes('INSERT INTO content_dev.campaign_draft_requests')).params.slice(0,4),[T,A,key,W]);
 assert.equal(calls.filter(x=>x.sql.includes('UPDATE content_dev.campaign_draft_requests')).length,1);
});
test('foreign workspace denies before any reservation or campaign insert',async()=>{
 const {writer,calls}=fixture({foreign:true});
 await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
 assert.equal(calls.some(x=>x.sql.includes('INSERT INTO content_dev.campaigns')),false);
});
test('replay checks JSONB equality in SQL, not JS property order',async()=>{
 const {writer,calls}=fixture({existing:[{campaign_id:C,same_request:true,valid_campaign:true}]});
 assert.deepEqual(await writer(principal,W,draft,key),{id:C,status:'draft',replayed:true});
 assert.match(calls.at(-1).sql,/r\.payload=\$5::jsonb/);
 assert.match(calls.at(-1).sql,/c\.product_service=\$6/);
 assert.match(calls.at(-1).sql,/c\.audience=\$7/);
 assert.match(calls.at(-1).sql,/c\.description=\$8/);
 assert.match(calls.at(-1).sql,/c\.problem=\$9/);
 assert.match(calls.at(-1).sql,/c\.objective=\$10/);
 assert.match(calls.at(-1).sql,/c\.duration_days=\$11/);
 assert.match(calls.at(-1).sql,/c\.platforms=\$12::text\[\]/);
 assert.deepEqual(calls.at(-1).params.slice(5),[
  draft.product_service,draft.audience,draft.description,draft.problem,
  draft.objective,draft.duration_days,draft.platforms
 ]);
});
test('mismatched replay or stale campaign link fails closed',async()=>{
 for(const row of [{campaign_id:C,same_request:false,valid_campaign:true},{campaign_id:C,same_request:true,valid_campaign:false}]){
  const {writer}=fixture({existing:[row]});
  await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
 }
});
test('unsafe database privileges or inherited role deny writes',async()=>{
 for(const config of [{roleRow:{...role,inherits:true}},{roleRow:{...role,can_create_role:true}},{postureRow:{...posture,credits:true}},{postureRow:{...posture,forced:1}}]){
  const {writer,calls}=fixture(config);
  await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
  assert.equal(calls.some(x=>x.sql.includes('INSERT INTO content_dev.campaigns')),false);
 }
});

test('idempotency lock is acquired before mutation using tenant, principal and key',async()=>{
 const {writer,calls}=fixture({insert:[{id:C}]});
 await writer(principal,W,draft,key);
 const lockIndex=calls.findIndex(x=>x.sql.includes('pg_advisory_xact_lock'));
 const insertIndex=calls.findIndex(x=>x.sql.includes('INSERT INTO content_dev.campaign_draft_requests'));
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

test('draft insertion and reservation link execute as separate ordered statements',async()=>{
 const {writer,calls}=fixture({insert:[{id:C}]});
 await writer(principal,W,draft,key);
 const reservation=calls.findIndex(x=>x.sql.includes('INSERT INTO content_dev.campaign_draft_requests'));
 const campaign=calls.findIndex(x=>x.sql.includes('INSERT INTO content_dev.campaigns'));
 const link=calls.findIndex(x=>x.sql.includes('UPDATE content_dev.campaign_draft_requests'));
 assert.ok(reservation>=0&&campaign>reservation&&link>campaign);
 assert.equal(calls[link].params[3],C);
});

test('verified principal context precedes membership query and any draft mutation',async()=>{
 const {writer,calls}=fixture({insert:[{id:C}]});
 await writer(principal,W,draft,key);
 const context=calls.findIndex(x=>x.sql.includes("set_config('bci.principal_id'"));
 const membership=calls.findIndex(x=>x.sql.includes('FROM content_dev.workspaces'));
 const mutation=calls.findIndex(x=>x.sql.includes('INSERT INTO content_dev.campaign_draft_requests'));
 assert.ok(context>=0&&membership>context&&mutation>membership);
 assert.deepEqual(calls[context].params,[A]);
});

test('identity context mismatch denies before reservation or campaign mutation',async()=>{
 const {writer,calls}=fixture({contextPrincipal:'55555555-5555-4555-8555-555555555555',insert:[{id:C}]});
 await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
 assert.equal(calls.some(x=>x.sql.includes('INSERT INTO content_dev.campaigns')),false);
});

test('malformed campaign input is rejected before any database connection',async()=>{
 for(const invalid of [
  {...draft,product_service:''}, {...draft,platforms:[]},
  {...draft,platforms:['facebook','facebook']},
  {...draft,platforms:['unknown']}, {...draft,duration_days:0},
  {...draft,duration_days:91}, {...draft,duration_days:1.5},
  {...draft,objective:'x'.repeat(2001)}
 ]){
  const {writer,calls}=fixture();
  await assert.rejects(writer(principal,W,invalid,key),ContentReadDenied);
  assert.equal(calls.length,0);
 }
});

test('same idempotency key cannot replay a draft whose stored brief fails integrity check',async()=>{
 const {writer,calls}=fixture({existing:[{campaign_id:C,same_request:true,valid_campaign:false}]});
 await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
 assert.equal(calls.some(x=>x.sql.includes('INSERT INTO content_dev.campaigns')),false);
 assert.equal(calls.some(x=>x.sql.includes('UPDATE content_dev.campaign_draft_requests')),false);
});

// A reservation and campaign INSERT must never be reported as saved when the
// final idempotency link cannot be committed. The injected transaction rejects;
// the real PostgreSQL integration suite separately owns rollback verification.
test('failed reservation link denies success after campaign insert',async()=>{
 const {writer,calls}=fixture({insert:[{id:C}],linkSuccess:false});
 await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
 assert.equal(calls.filter(x=>x.sql.includes('INSERT INTO content_dev.campaigns')).length,1);
 assert.equal(calls.filter(x=>x.sql.includes('UPDATE content_dev.campaign_draft_requests')).length,1);
});

test('existing idempotency reservation with missing campaign link fails closed',async()=>{
 const {writer,calls}=fixture({existing:[{campaign_id:null,same_request:true,valid_campaign:false}]});
 await assert.rejects(writer(principal,W,draft,key),ContentReadDenied);
 assert.equal(calls.some(x=>x.sql.includes('INSERT INTO content_dev.campaigns')),false);
});
