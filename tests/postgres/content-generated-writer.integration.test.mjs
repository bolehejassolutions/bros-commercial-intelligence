/**
 * True PostgreSQL integration test. RUN ONLY against ephemeral GitHub Actions
 * postgres:16 fixture. Never read Neon connection strings or production env.
 */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createContentTransaction} from '../../lib/content/neon-content-transaction.ts';
import {createContentGeneratedOutputWriter} from '../../lib/content/neon-content-generated-output-writer.ts';
import {ContentReadDenied} from '../../lib/content/neon-content-workspace-reader.ts';

if(process.env.CONTENT_PG_INTEGRATION_CI!=='disposable_only'||
 !process.env.CONTENT_TEST_DB_URL?.includes('127.0.0.1:5432/bros_intelligence_dev')||
 !process.env.CONTENT_ADMIN_DB_URL?.includes('127.0.0.1:5432/bros_intelligence_dev')){
 throw Error('Refusing non-disposable database target');
}
const OWNER='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const FOREIGN='11111111-1111-4111-8111-111111111111';
const WORKSPACE='22222222-2222-4222-8222-222222222222';
const FOREIGN_WORKSPACE='77777777-7777-4777-8777-777777777777';
const FOREIGN_CAMPAIGN='88888888-8888-4888-8888-888888888888';
const TENANT='33333333-3333-4333-8333-333333333333';
const db=new pg.Pool({connectionString:process.env.CONTENT_TEST_DB_URL,max:6});
const admin=new pg.Pool({connectionString:process.env.CONTENT_ADMIN_DB_URL,max:2});
after(async()=>{await Promise.all([db.end(),admin.end()]);});
const write=createContentGeneratedOutputWriter(createContentTransaction(db));
const input={product_service:'BROS CONTENT',audience:'Malaysian SME',
 description:'Seven layer plan',problem:'Manual posting',objective:'Teach one principle',
 duration_days:7,platforms:['facebook','tiktok']};
const plan={
 strategy:{positioning:'Practical planning',core_message:'Explain the process',
 offer_angle:'System thinking',platform_strategy:['Facebook education','TikTok teaching']},
 angles:[{title:'Owner pain',hook:'Why content stalls',reason:'No repeatable workflow'}],
 scripts:[{title:'One script',hook:'A real business problem',body:'Explain the solution',cta:'Save this'}],
 scenes:[{scene_number:1,duration_seconds:6,visual_prompt:'Natural planning desk',
 motion_prompt:'Slow pan',narration:'One clear system',dialogue:''}],
 visuals:[{title:'One visual',prompt:'Realistic desk with checklist'}],
 captions:[{platform:'facebook',caption:'Build a repeatable system'}],
 publish_plan:[{day:1,platform:'facebook',content_type:'educational',objective:'Help owners'}]
};
const review={pass:true,score:88,issues:[],fixes:[]};
const ownerPrincipal={userId:OWNER,authenticated:true};
const foreignPrincipal={userId:FOREIGN,authenticated:true};
const args=(key,p=ownerPrincipal,w=WORKSPACE,sourcePlan=plan,q=review)=>[p,w,key,input,sourcePlan,q];
async function counts(){
 const x=await admin.query(`SELECT
 (SELECT count(*)::int FROM content_dev.campaigns WHERE tenant_id=$1) AS campaigns,
 (SELECT count(*)::int FROM content_dev.content_items WHERE tenant_id=$1) AS items,
 (SELECT count(*)::int FROM content_dev.scenes WHERE tenant_id=$1) AS scenes,
 (SELECT count(*)::int FROM content_dev.generated_output_requests WHERE tenant_id=$1) AS requests`,[TENANT]);
 return x.rows[0];
}
async function scopedSql(principal,sql,params=[]){
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('bci.principal_id','',true)");
  await client.query("SELECT set_config('bci.principal_id',$1,true)",[principal]);
  return await client.query(sql,params);
 }finally{try{await client.query('ROLLBACK');}finally{client.release();}}
}
test('real PostgreSQL 16: atomic authorization, persistence and rollback',async t=>{
 await t.test('new session directly uses restricted login; never owner/admin',async()=>{
  const p=await db.query("SELECT current_user AS role,session_user AS login");
  assert.equal(p.rows[0].role,'content_dev_generated_writer_v1');
  assert.equal(p.rows[0].login,'content_dev_generated_writer_v1');
  const posture=await db.query(`SELECT
   has_table_privilege(current_user,'content_dev.content_items','INSERT') AS can_items,
   has_table_privilege(current_user,'content_dev.scenes','INSERT') AS can_scenes,
   has_table_privilege(current_user,'content_dev.credit_ledger','INSERT') AS can_credits,
   has_table_privilege(current_user,'content_dev.generation_jobs','INSERT') AS can_jobs,
   has_schema_privilege(current_user,'content_import_dev','USAGE') AS can_staging,
   has_column_privilege(current_user,'content_dev.generated_output_requests','fingerprint','UPDATE') AS can_overwrite_key`);
  assert.deepEqual(posture.rows[0],{
   can_items:true,can_scenes:true,can_credits:false,can_jobs:false,
   can_staging:false,can_overwrite_key:false
  });
 });
 await t.test('unbound principal sees zero workspaces; owner cannot see foreign tenant',async()=>{
  const unbound=await db.query('SELECT count(*)::int AS count FROM content_dev.workspaces');
  assert.equal(unbound.rows[0].count,0);
  const foreign=await scopedSql(OWNER,'SELECT id FROM content_dev.workspaces WHERE id=$1',[FOREIGN_WORKSPACE]);
  assert.equal(foreign.rows.length,0);
  const campaigns=await scopedSql(OWNER,'SELECT id FROM content_dev.campaigns WHERE id=$1',[FOREIGN_CAMPAIGN]);
  assert.equal(campaigns.rows.length,0);
  const matching=await scopedSql(OWNER,'SELECT id FROM content_dev.workspaces WHERE id=$1',[WORKSPACE]);
  assert.equal(matching.rows.length,1);
 });
 await t.test('authorized owner creates exactly one draft, three content items and one scene',async()=>{
  const baseline=await counts();
  const response=await write(...args('ci-real-save-one-20261107'));
  assert.equal(response.replayed,false);
  assert.equal(response.status,'draft');
  const after=await counts();
  assert.deepEqual(after,{
   campaigns:baseline.campaigns+1,
   items:baseline.items+3,
   scenes:baseline.scenes+1,
   requests:baseline.requests+1
  });
  const content=await admin.query(`SELECT
   c.status,c.owner_principal_id,c.tenant_id,
   (SELECT array_agg(i.type ORDER BY i.type) FROM content_dev.content_items i
    WHERE i.campaign_id=c.id) AS types
   FROM content_dev.campaigns c WHERE c.id=$1`,[response.id]);
  assert.equal(content.rows[0].status,'draft');
  assert.equal(content.rows[0].owner_principal_id,OWNER);
  assert.equal(content.rows[0].tenant_id,TENANT);
  assert.deepEqual(content.rows[0].types,['script','video_scenes','visual_prompt']);
 });
 await t.test('same database key replays without duplicating any row',async()=>{
  const baseline=await counts();
  const replay=await write(...args('ci-real-save-one-20261107'));
  assert.equal(replay.replayed,true);
  assert.deepEqual(await counts(),baseline);
 });
 await t.test('changed QC with same key is denied, and counts do not change',async()=>{
  const baseline=await counts();
  await assert.rejects(
   write(...args('ci-real-save-one-20261107',ownerPrincipal,WORKSPACE,plan,{...review,score:89})),
   ContentReadDenied
  );
  assert.deepEqual(await counts(),baseline);
 });
 await t.test('foreign owner cannot use owner workspace or create rows',async()=>{
  const baseline=await counts();
  await assert.rejects(write(...args('ci-real-foreign-block-20261107',foreignPrincipal)),
   ContentReadDenied);
  assert.deepEqual(await counts(),baseline);
 });
 await t.test('revoked CONTENT membership immediately denies new writes and prior data access',async()=>{
  const before=await counts();
  try{
   await admin.query(`UPDATE bci_dev.tenant_memberships SET active=false
    WHERE tenant_id=$1 AND principal_id=$2 AND product='content'`,[TENANT,OWNER]);
   const visible=await scopedSql(OWNER,'SELECT id FROM content_dev.workspaces WHERE id=$1',[WORKSPACE]);
   assert.equal(visible.rows.length,0);
   await assert.rejects(write(...args('ci-revoked-membership-20261107')),ContentReadDenied);
   assert.deepEqual(await counts(),before);
  }finally{
   await admin.query(`UPDATE bci_dev.tenant_memberships SET active=true
    WHERE tenant_id=$1 AND principal_id=$2 AND product='content'`,[TENANT,OWNER]);
  }
 });
 await t.test('separate tenant can save its own draft but cannot access first tenant',async()=>{
  const first=await counts();
  const other=await write(...args('ci-foreign-own-workspace-20261107',foreignPrincipal,FOREIGN_WORKSPACE));
  assert.equal(other.status,'draft');
  assert.equal(other.replayed,false);
  assert.deepEqual(await counts(),first,'Owner tenant rows remain identical');
  const x=await admin.query('SELECT tenant_id,owner_principal_id FROM content_dev.campaigns WHERE id=$1',[other.id]);
  assert.equal(x.rows[0].tenant_id,'66666666-6666-4666-8666-666666666666');
  assert.equal(x.rows[0].owner_principal_id,FOREIGN);
  const noRead=await scopedSql(OWNER,'SELECT id FROM content_dev.campaigns WHERE id=$1',[other.id]);
  assert.equal(noRead.rows.length,0);
 });
 await t.test('cross-tenant content item insert denied by RLS, even with known campaign ID',async()=>{
  const count=await admin.query('SELECT count(*)::int AS n FROM content_dev.content_items');
  await assert.rejects(
   scopedSql(OWNER,`INSERT INTO content_dev.content_items
    (tenant_id,campaign_id,type,title,body,sort_order,version)
    VALUES('66666666-6666-4666-8666-666666666666',$1,'script','Forbidden','{}',0,1)`,
    [FOREIGN_CAMPAIGN]),/row-level security|permission denied/i
  );
  const current=await admin.query('SELECT count(*)::int AS n FROM content_dev.content_items');
  assert.equal(current.rows[0].n,count.rows[0].n);
 });
 await t.test('scene constraint violation after inserts atomically rolls all rows back',async()=>{
  const baseline=await counts();
  const poisonedPlan={
   ...plan,scenes:[{...plan.scenes[0],visual_prompt:'__CI_FORCE_ROLLBACK__'}]
  };
  await assert.rejects(
   write(...args('ci-real-rollback-20261107',ownerPrincipal,WORKSPACE,poisonedPlan)),
   /check constraint|ci_force_rollback/i
  );
  assert.deepEqual(await counts(),baseline);
 });
 await t.test('parallel same-key submits across two connections serialize to one campaign',async()=>{
  const baseline=await counts();
  const results=await Promise.all([
   write(...args('ci-concurrent-request-20261107')),
   write(...args('ci-concurrent-request-20261107'))
  ]);
  assert.equal(results[0].id,results[1].id);
  assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
  assert.deepEqual(await counts(),{
   campaigns:baseline.campaigns+1,
   items:baseline.items+3,
   scenes:baseline.scenes+1,
   requests:baseline.requests+1
  });
 });
});
