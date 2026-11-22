import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executeContentDevFixtureAtomically} from '../lib/content/neon-content-dev-fixture-transaction.ts';

const T='846fd30b-0085-4441-b0ad-9eaab84cc715';
const P='416f2922-d8fb-4886-a18b-4a106940e845';
const J='65c72183-a16f-4003-8dcf-94e6606df1a4';
const C='3e81f2c5-aa57-4732-8c8d-999bf38f51ad';
const I='9f1c8b28-a7c1-4e16-b68e-cbfa91f7040e';
const fixture={type:'script',title:'Synthetic DEV test',body:{text:'For safe development acceptance only'}};
const input={tenantId:T,principalId:P,jobId:J,fixture};
const job={id:J,tenant_id:T,campaign_id:C,requested_by:P,idempotency_key:'synthetic-idempotency',status:'running',attempts:1,error_code:null};
function makePool(options={}){
 const log=[];let releases=[];let lookups=0;
 const gate={
  rolname:options.role??'content_dev_fixture_executor_v1',
  rolcanlogin:true,rolsuper:false,rolbypassrls:false,forced:true,
  tables:3,policy_tables:3,job_select:true,job_update:options.jobUpdate??true,
  item_select:true,item_insert:true,campaign_select:true,
 };
 const client={
  async query(sql,params=[]){
   log.push({sql,params});
   if(sql==='BEGIN'||sql==='SET LOCAL row_security = on'||sql==='ROLLBACK')return {rows:[]};
   if(sql==='COMMIT'){
    if(options.commitFailure)throw Error('COMMIT_UNCERTAIN');
    return {rows:[]};
   }
   if(sql.includes('FROM pg_roles r WHERE r.rolname=current_user'))return {rows:[gate]};
   if(sql.includes("set_config('bci.principal_id'"))return {rows:[{set_config:params[0]}]};
   if(sql.includes('FROM bci_dev.tenant_memberships'))return {rows:options.noMembership?[]:[{tenant_id:T}]};
   if(sql.includes("SET status='running'"))return {rows:options.noClaim?[]:[job]};
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.includes('SELECT id FROM content_dev.campaigns'))return {rows:[{id:C}]};
   if(sql.includes('SELECT id,type,title,body FROM content_dev.content_items')){
    lookups+=1;
    return {rows:lookups===1?[]:[{
     id:I,type:fixture.type,title:fixture.title,
     body:{...fixture.body,provenance:{source:'deterministic_dev_fixture',job_id:J}}
    }]};
   }
   if(sql.includes('INSERT INTO content_dev.content_items'))return {rows:[{id:I}]};
   if(sql.includes('SET status=$4,error_code=$5'))return {rows:[{...job,status:'completed'}]};
   throw Error('Unexpected query: '+sql);
  },
  release(error){releases.push(error)}
 };
 return {pool:{async connect(){log.push({sql:'POOL_CONNECT'});return client}},log,releases};
}

test('restricted DEV transaction saves and reads back fixture atomically',async()=>{
 const {pool,log,releases}=makePool();
 const result=await executeContentDevFixtureAtomically(pool,input);
 assert.equal(result.itemId,I);
 assert.equal(result.attempt,1);
 assert.equal(result.source,'deterministic_dev_fixture');
 assert.deepEqual(log.slice(0,3).map(x=>x.sql),['POOL_CONNECT','BEGIN','SET LOCAL row_security = on']);
 assert.ok(log.some(x=>x.sql.includes("set_config('bci.principal_id'")&&x.params[0]===P));
 assert.ok(log.some(x=>x.sql==='COMMIT'));
 assert.ok(!log.some(x=>x.sql==='ROLLBACK'));
 assert.equal(releases.length,1);
 assert.equal(releases[0],undefined);
});
test('missing principal is rejected before any database connection',async()=>{
 const {pool,log}=makePool();
 await assert.rejects(executeContentDevFixtureAtomically(pool,{...input,principalId:''}),/verified fixture identity/);
 assert.equal(log.length,0);
});
test('wrong login role fails closed and rolls back',async()=>{
 const {pool,log}=makePool({role:'bros_intelligence_dev_owner'});
 await assert.rejects(executeContentDevFixtureAtomically(pool,input),/fixture transaction failed/);
 assert.ok(log.some(x=>x.sql==='ROLLBACK'));
 assert.ok(!log.some(x=>x.sql.includes("set_config('bci.principal_id'")));
});
test('column-level privilege deficiency fails closed',async()=>{
 const {pool,log}=makePool({jobUpdate:false});
 await assert.rejects(executeContentDevFixtureAtomically(pool,input),/fixture transaction failed/);
 assert.ok(log.some(x=>x.sql==='ROLLBACK'));
});
test('revoked membership fails closed and prevents claim or insert',async()=>{
 const {pool,log}=makePool({noMembership:true});
 await assert.rejects(executeContentDevFixtureAtomically(pool,input),/fixture transaction failed/);
 assert.ok(log.some(x=>x.sql==='ROLLBACK'));
 assert.ok(!log.some(x=>x.sql.includes("SET status='running'")));
 assert.ok(!log.some(x=>x.sql.includes('INSERT INTO content_dev.content_items')));
});
test('completed or unclaimable job cannot create a duplicate item',async()=>{
 const {pool,log}=makePool({noClaim:true});
 await assert.rejects(executeContentDevFixtureAtomically(pool,input),/fixture transaction failed/);
 assert.ok(log.some(x=>x.sql==='ROLLBACK'));
 assert.ok(!log.some(x=>x.sql.includes('INSERT INTO content_dev.content_items')));
});
test('failed COMMIT discards connection rather than trusting uncertain outcome',async()=>{
 const {pool,releases}=makePool({commitFailure:true});
 await assert.rejects(executeContentDevFixtureAtomically(pool,input),/fixture transaction failed/);
 assert.equal(releases.length,1);
 assert.ok(releases[0] instanceof Error);
});
test('production environment refuses DEV transaction before connecting',async()=>{
 const previous=process.env.VERCEL_ENV;
 process.env.VERCEL_ENV='production';
 try{
  const {pool,log}=makePool();
  await assert.rejects(executeContentDevFixtureAtomically(pool,input),/verified fixture identity/);
  assert.equal(log.length,0);
 }finally{
  if(previous===undefined)delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV=previous;
 }
});
