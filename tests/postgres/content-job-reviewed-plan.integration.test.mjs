import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test, {after} from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runHostedContentJob} from '../../scripts/content-hosted-dev-job.mjs';
import pg from 'pg';
import {createContentCampaignPlanner} from '../../lib/content/neon-content-generation-orchestrator.ts';
import {createPooledContentJobSubmitter} from '../../lib/content/neon-content-generation-job-atomic-submission.ts';
import {ContentJobNotEligible} from '../../lib/content/neon-content-generation-job-lifecycle.ts';
import {createContentJobHistoryReader} from '../../lib/content/neon-content-generation-job-history-reader.ts';
import {createContentTransaction} from '../../lib/content/neon-content-transaction.ts';
import {processReviewedContentJob} from '../../lib/content/neon-content-reviewed-job.ts';

function disposablePool(variable,role) {
 const url=new URL(process.env[variable]);
 assert.ok(process.env.CONTENT_PG_INTEGRATION_CI==='disposable_only' && url.protocol==='postgresql:' &&
  url.hostname==='127.0.0.1' && url.port==='5432' && url.pathname==='/bros_intelligence_dev' &&
  url.username===role && url.password && !url.search && !url.hash,'Refusing non-disposable database');
 return new pg.Pool({connectionString:url.href,max:3});
}
const admin=disposablePool('CONTENT_ADMIN_DB_URL','postgres');
const submitPool=disposablePool('CONTENT_JOB_WRITER_DB_URL','content_dev_job_writer_v2');
const planPool=disposablePool('CONTENT_JOB_PLAN_DB_URL','content_dev_job_plan_worker_v1');
const readPool=disposablePool('CONTENT_READER_DB_URL','content_dev_reader_v2');
after(()=>Promise.all([admin.end(),submitPool.end(),planPool.end(),readPool.end()]));
const submit=createPooledContentJobSubmitter(submitPool);
const history=createContentJobHistoryReader(createContentTransaction(readPool));

const {plan,review}=JSON.parse(await readFile(
 new URL('../../scripts/fixtures/content-dev-reviewed-plan.json',import.meta.url),'utf8'));
const planner=createContentCampaignPlanner(async (_prompt,_schema,name)=>name==='bros_campaign'?plan:review);

async function selectedDraft() {
 const [tenantId,userId,workspaceId,campaignId,legacyId]=Array.from({length:5},()=>randomUUID());
 await admin.query("INSERT INTO bci_dev.tenant_memberships(tenant_id,principal_id,product) VALUES($1,$2,'content')",[tenantId,userId]);
 await admin.query(`INSERT INTO content_dev.workspaces(id,tenant_id,owner_principal_id,name,business_dna)
  VALUES($1,$2,$3,'Workshop','{"brand":"Bengkel Basikal"}')`,[workspaceId,tenantId,userId]);
 await admin.query(`INSERT INTO content_dev.campaigns(id,tenant_id,workspace_id,owner_principal_id,product_service,
  audience,duration_days,platforms,legacy_supabase_id) VALUES($1,$2,$3,$4,'Servis basikal','Pemilik basikal',7,'{instagram}',$5)`,
  [campaignId,tenantId,workspaceId,userId,legacyId]);
 const principal={userId,authenticated:true};
 const request={workspaceId,campaignId,idempotencyKey:randomUUID()};
 const {id:jobId}=await submit(principal,request);
 return {tenantId,userId,workspaceId,campaignId,legacyId,principal,request,jobId};
}
const processJob=(draft,planCampaign=planner,extra={})=>processReviewedContentJob({
 pool:planPool,tenantId:draft.tenantId,jobId:draft.jobId,planCampaign,...extra});
const countItems=async draft=>(await admin.query(
 'SELECT count(*)::int AS count FROM content_dev.content_items WHERE tenant_id=$1 AND campaign_id=$2',
 [draft.tenantId,draft.campaignId])).rows[0].count;

test('persist a vetted plan onto the submitted draft and independently read all seven layers, provenance and job history',async()=>{
 const draft=await selectedDraft();
 let calls=0;
 const selectedPlanner=createContentCampaignPlanner(async (prompt,_schema,name)=>{
  calls++;
  assert.ok(prompt.includes('Bengkel Basikal') && prompt.includes('Servis basikal'));
  return name==='bros_campaign'?plan:review;
 });
 assert.equal((await processJob(draft,selectedPlanner)).state,'completed');
 assert.equal(calls,2);
 assert.equal((await processJob(draft,selectedPlanner)).state,'unavailable');
 assert.equal(calls,2);
 assert.equal((await submit(draft.principal,draft.request)).id,draft.jobId);
 const [campaign]=(await admin.query(`SELECT id,legacy_supabase_id,strategy,angles,captions,publish_plan
  FROM content_dev.campaigns WHERE tenant_id=$1`,[draft.tenantId])).rows;
 assert.equal(campaign.id,draft.campaignId);
 assert.equal(campaign.legacy_supabase_id,draft.legacyId);
 assert.deepEqual(campaign.strategy,plan.strategy);
 assert.deepEqual(campaign.angles,plan.angles);
 assert.deepEqual(campaign.captions,{instagram:plan.captions[0].caption});
 assert.deepEqual(campaign.publish_plan,plan.publish_plan);
 const {rows:items}=await admin.query(`SELECT id,type,body,title,sort_order,version FROM content_dev.content_items
  WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY type,sort_order`,[draft.tenantId,draft.campaignId]);
 assert.equal(items.length,4);
 for (const item of items) {
  const {provenance,...body}=item.body;
  assert.equal(item.version,1);
  assert.equal(provenance.source,'injected_content_planner');
  assert.equal(provenance.job_id,draft.jobId);
  assert.equal(provenance.quality_score,review.score);
  assert.equal(provenance.attempt,1);
  assert.match(provenance.content_fingerprint,/^[a-f0-9]{64}$/);
  assert.match(provenance.review_sha256,/^[a-f0-9]{64}$/);
  const expected=item.type==='script'?plan.scripts[item.sort_order]:
   item.type==='visual_prompt'?plan.visuals[item.sort_order]:{count:2};
  assert.deepEqual(body,expected);
 }
 const scenes=(await admin.query(`SELECT s.content_item_id,s.scene_number,s.duration_seconds::float8,s.narration,s.dialogue,
  s.visual_prompt,s.motion_prompt FROM content_dev.scenes s WHERE s.tenant_id=$1 ORDER BY s.scene_number`,[draft.tenantId])).rows;
 assert.deepEqual(scenes.map(({content_item_id,...scene})=>{
  assert.equal(content_item_id,items.find(item=>item.type==='video_scenes').id);
  return scene;
 }),plan.scenes);
 const [job]=await history(draft.principal,draft.workspaceId,draft.campaignId);
 assert.equal(job.id,draft.jobId);
 assert.equal(job.status,'completed');
 assert.equal(job.attempts,1);
 assert.deepEqual(Object.keys(job).sort(),['id','status','attempts','errorCode','createdAt','claimedAt','completedAt'].sort());
 await assert.rejects(submit(draft.principal,{...draft.request,idempotencyKey:randomUUID()}),ContentJobNotEligible);
 assert.equal(calls,2);
 assert.equal(await countItems(draft),4);
});

test('reject low quality and roll back every row on late scene failure, then retry the same draft',async()=>{
 const draft=await selectedDraft();
 const low=createContentCampaignPlanner(async (_p,_s,name)=>name==='bros_campaign'?plan:{...review,score:40});
 assert.equal((await processJob(draft,low)).state,'failed');
 const rejected={...plan,scenes:plan.scenes.map((s,i)=>i===1?{...s,visual_prompt:'__CI_FORCE_ROLLBACK__'}:s)};
 const badScene=createContentCampaignPlanner(async (_p,_s,name)=>name==='bros_campaign'?rejected:review);
 assert.equal((await processJob(draft,badScene)).state,'failed');
 assert.equal(await countItems(draft),0);
 const [row]=(await admin.query('SELECT strategy,angles,captions,publish_plan FROM content_dev.campaigns WHERE id=$1',[draft.campaignId])).rows;
 assert.deepEqual(row,{strategy:null,angles:null,captions:null,publish_plan:null});
 assert.equal((await processJob(draft)).state,'completed');
 assert.equal((await history(draft.principal,draft.workspaceId,draft.campaignId))[0].attempts,3);
});

test('reject foreign claims, changed briefs and membership revoked during planning',async()=>{
 const draft=await selectedDraft();
 let calls=0;
 const changed=async (...args)=>{
  calls++;
  await admin.query("UPDATE content_dev.campaigns SET objective='Changed during planning' WHERE id=$1",[draft.campaignId]);
  return planner(...args);
 };
 assert.equal((await processJob({...draft,tenantId:randomUUID()},changed)).state,'unavailable');
 assert.equal(calls,0);
 assert.equal((await processJob(draft,changed)).state,'failed');
 assert.equal(await countItems(draft),0);
 const revoke=async (...args)=>{
  await admin.query("UPDATE bci_dev.tenant_memberships SET active=false WHERE tenant_id=$1 AND principal_id=$2",[draft.tenantId,draft.userId]);
  return planner(...args);
 };
 assert.equal((await processJob(draft,revoke)).state,'lost_lease');
 assert.equal(await countItems(draft),0);
 await assert.rejects(history(draft.principal,draft.workspaceId,draft.campaignId));
});

test('only the current attempt can attach reviewed output after a lease is recovered',async()=>{
 const draft=await selectedDraft();
 let release,start;
 const waiting=new Promise(resolve=>{start=resolve;});
 const resume=new Promise(resolve=>{release=resolve;});
 const pending=processJob(draft,async (...args)=>{start();await resume;return planner(...args);});
 await waiting;
 try {
  await admin.query("UPDATE content_dev.generation_jobs SET claimed_at=now()-interval '1 hour' WHERE id=$1",[draft.jobId]);
  assert.equal((await processJob(draft,planner,{recoverExpired:true,leaseSeconds:30})).state,'completed');
 } finally {release();}
 assert.equal((await pending).state,'lost_lease');
 assert.equal(await countItems(draft),4);
 const rows=await admin.query("SELECT DISTINCT body->'provenance'->>'attempt' AS attempt FROM content_dev.content_items WHERE campaign_id=$1",[draft.campaignId]);
 assert.deepEqual(rows.rows,[{attempt:'2'}]);
});


test('hosted DEV worker validates its target and reviewed packet, then commits once with the restricted login', async t => {
 const draft=await selectedDraft();
 const host='ep-fancy-queen-b30g0cjn.c-4.ap-southeast-1.aws.neon.tech';
 const role='content_dev_job_plan_worker_v1';
 const url='postgresql://'+role+':fixture@'+host+'/bros_intelligence_dev?sslmode=verify-full';
 const env={CONTENT_HOSTED_DEV_WORKER_ENABLED:'true',CONTENT_HOSTED_DEV_PLAN_DATABASE_URL:url};
 const dir=await mkdtemp(join(tmpdir(),'content-reviewed-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'reviewed.json');
 const args=[draft.tenantId,draft.jobId,file];
 const packet={tenantId:draft.tenantId,jobId:draft.jobId,plan,review,businessDna:{brand:'Bengkel Basikal'},
  brief:{product_service:'Servis basikal',audience:'Pemilik basikal',duration_days:7,platforms:['instagram'],
   description:'',problem:'',objective:''}};
 // Only the outbound connection is substituted. Posture checks, claim, plan verification,
 // writes, readback and completion use actual restricted PostgreSQL connections.
 let connections=0;
 const connect=config=>{
  connections++;
  assert.deepEqual(config,{host,user:role,port:5432,database:'bros_intelligence_dev',password:'fixture',
   ssl:{rejectUnauthorized:true,servername:host},max:1,connectionTimeoutMillis:5000});
  return disposablePool('CONTENT_JOB_PLAN_DB_URL',role);
 };
 for (const overrides of [
  {CONTENT_HOSTED_DEV_WORKER_ENABLED:''},{VERCEL_ENV:'production'},
  {CONTENT_HOSTED_DEV_PLAN_DATABASE_URL:undefined,CONTENT_JOB_PLAN_DB_URL:url},
  ...[url.replace(host,'127.0.0.1'),url.replace(host,'other.neon.tech'),url.replace(role,'postgres'),
      url.replace('bros_intelligence_dev','production'),url.replace('verify-full','disable'),
      url+'&options=extra'].map(value=>({CONTENT_HOSTED_DEV_PLAN_DATABASE_URL:value})),
 ]) {
  await assert.rejects(runHostedContentJob(args,{...env,...overrides},connect),/restricted TLS login/);
 }
 for (const changes of [{tenantId:randomUUID()},{jobId:randomUUID()},{review:{...review,score:1}}]) {
  await writeFile(file,JSON.stringify({...packet,...changes}));
  await assert.rejects(runHostedContentJob(args,env,connect),/accepted review/);
 }
 assert.equal(connections,0);
 const checkArgs=['--check',draft.tenantId];
 assert.deepEqual(await runHostedContentJob(checkArgs,env,connect),{state:'restricted_login_verified'});
 await assert.rejects(runHostedContentJob(checkArgs,env,()=>disposablePool('CONTENT_READER_DB_URL','content_dev_reader_v2')),
  /Restricted CONTENT role unavailable/);
 const credits=async()=>(await admin.query('SELECT id FROM content_dev.credit_ledger ORDER BY id')).rows;
 const before=await credits();
 await writeFile(file,JSON.stringify({...packet,businessDna:{brand:'Outdated'}}));
 assert.equal((await runHostedContentJob(args,env,connect)).state,'failed');
 assert.equal(await countItems(draft),0);
 await writeFile(file,JSON.stringify(packet));
 assert.deepEqual(await runHostedContentJob(args,env,connect),{jobId:draft.jobId,state:'completed'});
 assert.equal((await runHostedContentJob(args,env,connect)).state,'unavailable');
 const jobs=await history(draft.principal,draft.workspaceId,draft.campaignId);
 assert.deepEqual(jobs.map(({id,status,attempts})=>({id,status,attempts})),[{id:draft.jobId,status:'completed',attempts:2}]);
 const {rows:[saved]}=await admin.query(`SELECT strategy,angles,captions,publish_plan,
  (SELECT count(*)::int FROM content_dev.scenes s JOIN content_dev.content_items i ON i.id=s.content_item_id
    WHERE i.campaign_id=c.id AND i.tenant_id=c.tenant_id) AS scenes FROM content_dev.campaigns c WHERE id=$1 AND tenant_id=$2`,
  [draft.campaignId,draft.tenantId]);
 assert.deepEqual(saved,{strategy:plan.strategy,angles:plan.angles,captions:{instagram:plan.captions[0].caption},
  publish_plan:plan.publish_plan,scenes:plan.scenes.length});
 assert.equal(await countItems(draft),plan.scripts.length+plan.visuals.length+1);
 assert.deepEqual(await credits(),before);
});
