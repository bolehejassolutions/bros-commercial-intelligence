import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createContentTransaction} from '../../lib/content/neon-content-transaction.ts';
import {createContentJobHistoryReader} from '../../lib/content/neon-content-generation-job-history-reader.ts';
import {ContentReadDenied} from '../../lib/content/neon-content-workspace-reader.ts';
import {enqueueContentJob,claimContentJob,reclaimExpiredContentJob,finishContentJob,listContentCampaignJobs} from '../../lib/content/neon-content-generation-job-lifecycle.ts';

const url=process.env.CONTENT_ADMIN_DB_URL;
if(process.env.CONTENT_PG_INTEGRATION_CI!=='disposable_only'||
 !url?.startsWith('postgresql://postgres:')||
 !url.includes('@127.0.0.1:5432/bros_intelligence_dev'))
 throw Error('Refusing non-disposable PostgreSQL');
const pool=new pg.Pool({connectionString:url,max:1});
after(()=>pool.end());
const tenant='33333333-3333-4333-8333-333333333333';
const owner='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const other='66666666-6666-4666-8666-666666666666';
const campaign='88888888-8888-4888-8888-888888888888';
const ownCampaign='99999999-9999-4999-8999-999999999999';
test('durable queued → running → failed → retry → completed with strict identity',async()=>{
 await pool.query(`INSERT INTO content_dev.campaigns(id,tenant_id,workspace_id,owner_principal_id,product_service,audience,duration_days,status)
 VALUES ($1,$2,'22222222-2222-4222-8222-222222222222',$3,'Job fixture','Owner',7,'draft')`,
 [ownCampaign,tenant,owner]);
 const input={tenantId:tenant,campaignId:ownCampaign,principalId:owner,idempotencyKey:'safe-retry-20261114'};
 const queued=await enqueueContentJob(pool,input);
 assert.equal(queued?.status,'queued');
 assert.equal((await enqueueContentJob(pool,input))?.id,queued.id);
 await assert.rejects(enqueueContentJob(pool,{...input,campaignId:campaign}),/conflict/);
 await assert.rejects(enqueueContentJob(pool,{...input,principalId:'11111111-1111-4111-8111-111111111111'}),/not authorized|conflict/);
 assert.equal(await claimContentJob(pool,{tenantId:other,jobId:queued.id}),null);
 const running=await claimContentJob(pool,{tenantId:tenant,jobId:queued.id,maxAttempts:2});
 assert.equal(running?.attempts,1);
 assert.equal(await claimContentJob(pool,{tenantId:tenant,jobId:queued.id,maxAttempts:2}),null);
 assert.equal(await finishContentJob(pool,{tenantId:tenant,jobId:queued.id,attempt:2,outcome:'completed'}),null);
 const failed=await finishContentJob(pool,{tenantId:tenant,jobId:queued.id,attempt:1,outcome:'failed',errorCode:'PROVIDER_UNAVAILABLE'});
 assert.equal(failed?.status,'failed');
 const retry=await claimContentJob(pool,{tenantId:tenant,jobId:queued.id,maxAttempts:2});
 assert.equal(retry?.attempts,2);
 const completed=await finishContentJob(pool,{tenantId:tenant,jobId:queued.id,attempt:2,outcome:'completed'});
 assert.equal(completed?.status,'completed');
 assert.equal(await claimContentJob(pool,{tenantId:tenant,jobId:queued.id,maxAttempts:2}),null);
 const rows=await pool.query('SELECT status,attempts,count(*) OVER () AS count FROM content_dev.generation_jobs WHERE id=$1',[queued.id]);
 assert.equal(rows.rows[0].status,'completed');
 assert.equal(rows.rows[0].attempts,2);
 assert.equal(Number(rows.rows[0].count),1);
 const history=await listContentCampaignJobs(pool,{tenantId:tenant,campaignId:ownCampaign,principalId:owner});
 assert.equal(history.some(job=>job.id===queued.id),true);
 assert.deepEqual(await listContentCampaignJobs(pool,{tenantId:other,campaignId:ownCampaign,principalId:owner}),[]);
 assert.deepEqual(await listContentCampaignJobs(pool,{tenantId:tenant,campaignId:ownCampaign,principalId:other}),[]);
});

test('abandoned running lease is fenced and recovered without duplicate jobs',async()=>{
 const input={tenantId:tenant,campaignId:ownCampaign,principalId:owner,idempotencyKey:'lease-recovery-20261115'};
 const queued=await enqueueContentJob(pool,input);
 const first=await claimContentJob(pool,{tenantId:tenant,jobId:queued.id,maxAttempts:2});
 assert.equal(first?.attempts,1);
 assert.equal(await reclaimExpiredContentJob(pool,{tenantId:tenant,jobId:queued.id,leaseSeconds:30,maxAttempts:2}),null);
 await pool.query("UPDATE content_dev.generation_jobs SET claimed_at=now()-interval '1 hour' WHERE id=$1",[queued.id]);
 assert.equal(await reclaimExpiredContentJob(pool,{tenantId:other,jobId:queued.id,leaseSeconds:30,maxAttempts:2}),null);
 const recovered=await reclaimExpiredContentJob(pool,{tenantId:tenant,jobId:queued.id,leaseSeconds:30,maxAttempts:2});
 assert.equal(recovered?.status,'running');
 assert.equal(recovered?.attempts,2);
 assert.equal(await finishContentJob(pool,{tenantId:tenant,jobId:queued.id,attempt:1,outcome:'completed'}),null);
 await pool.query("UPDATE content_dev.generation_jobs SET claimed_at=now()-interval '1 hour' WHERE id=$1",[queued.id]);
 const exhausted=await reclaimExpiredContentJob(pool,{tenantId:tenant,jobId:queued.id,leaseSeconds:30,maxAttempts:2});
 assert.equal(exhausted?.status,'failed');
 assert.equal(exhausted?.error_code,'RETRY_EXHAUSTED');
 assert.equal(await claimContentJob(pool,{tenantId:tenant,jobId:queued.id,maxAttempts:2}),null);
 const rows=await pool.query('SELECT count(*)::integer AS n FROM content_dev.generation_jobs WHERE id=$1',[queued.id]);
 assert.equal(rows.rows[0].n,1);
 await assert.rejects(reclaimExpiredContentJob(pool,{tenantId:tenant,jobId:queued.id,leaseSeconds:0}),/lease/);
});

// Same disposable database, after campaign creation in the first test.
test('persisted job history is chronological and tenant-scoped',async()=>{
 const a=await enqueueContentJob(pool,{tenantId:tenant,campaignId:ownCampaign,principalId:owner,idempotencyKey:'history-older-20261115'});
 const b=await enqueueContentJob(pool,{tenantId:tenant,campaignId:ownCampaign,principalId:owner,idempotencyKey:'history-newer-20261115'});
 await pool.query("UPDATE content_dev.generation_jobs SET created_at='2026-11-01T10:00:00Z' WHERE id=$1",[a.id]);
 await pool.query("UPDATE content_dev.generation_jobs SET created_at='2026-11-02T10:00:00Z' WHERE id=$1",[b.id]);
 const jobs=await listContentCampaignJobs(pool,{tenantId:tenant,campaignId:ownCampaign,principalId:owner});
 assert.ok(jobs.findIndex(j=>j.id===b.id)<jobs.findIndex(j=>j.id===a.id));
 assert.deepEqual(await listContentCampaignJobs(pool,{tenantId:other,campaignId:ownCampaign,principalId:owner}),[]);
});

test('authenticated restricted job history fails closed until explicitly granted in isolated PostgreSQL',async()=>{
 const readerUrl=process.env.CONTENT_READER_DB_URL;
 assert.ok(readerUrl?.includes('@127.0.0.1:5432/bros_intelligence_dev'));
 const readerPool=new pg.Pool({connectionString:readerUrl,max:1});
 try{
  const read=createContentJobHistoryReader(createContentTransaction(readerPool));
  const principal={userId:owner,authenticated:true};
  const workspace='22222222-2222-4222-8222-222222222222';
  await assert.rejects(read(principal,workspace,ownCampaign,10),ContentReadDenied);
  // CI-only grant and forced-RLS policy on the disposable Docker database.
  // NEVER copy to connected Neon without a separate owner permission decision.
  await pool.query('GRANT SELECT ON content_dev.generation_jobs TO content_dev_reader_v2');
  await pool.query(`CREATE POLICY ci_only_content_job_history ON content_dev.generation_jobs
    FOR SELECT TO content_dev_reader_v2 USING (
      requested_by=NULLIF(current_setting('bci.principal_id',true),'')::uuid
      AND EXISTS (SELECT 1 FROM content_dev.campaigns c WHERE
       c.id=generation_jobs.campaign_id AND c.tenant_id=generation_jobs.tenant_id
       AND c.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid)
    )`);
  const rows=await read(principal,workspace,ownCampaign,10);
  assert.ok(rows.length>=2);
  assert.ok(rows.every(r=>r.status&&r.createdAt&&!Object.hasOwn(r,'idempotency_key')));
  assert.ok(rows.every(r=>!Object.hasOwn(r,'requested_by')&&!Object.hasOwn(r,'tenant_id')));
  assert.deepEqual([...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)),rows);
  await assert.rejects(read({userId:other,authenticated:true},workspace,ownCampaign,10),ContentReadDenied);
  await assert.rejects(read(principal,'77777777-7777-4777-8777-777777777777',ownCampaign,10),ContentReadDenied);
 }finally{await readerPool.end();}
});
