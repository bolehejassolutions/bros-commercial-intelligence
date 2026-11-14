import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
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
 await pool.query(`ALTER TABLE content_dev.generation_jobs
 ADD COLUMN tenant_id uuid NOT NULL DEFAULT '33333333-3333-4333-8333-333333333333',
 ADD COLUMN campaign_id uuid NOT NULL DEFAULT '99999999-9999-4999-8999-999999999999',
 ADD COLUMN requested_by uuid NOT NULL DEFAULT '8ae086ff-3f10-4863-b5e7-4b67e062024d',
 ADD COLUMN idempotency_key text NOT NULL DEFAULT '',
 ADD COLUMN status text NOT NULL DEFAULT 'queued',
 ADD COLUMN attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN error_code text,
 ADD COLUMN claimed_at timestamptz,
 ADD COLUMN completed_at timestamptz`);
 await pool.query('CREATE UNIQUE INDEX ci_generation_idempotency ON content_dev.generation_jobs(tenant_id,requested_by,idempotency_key)');
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
