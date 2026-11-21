import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createPooledContentJobSubmitter} from '../../lib/content/neon-content-generation-job-atomic-submission.ts';
import {createContentJobPost} from '../../lib/content/neon-content-generation-job-submission-http.ts';
import {processContentFixtureJob} from '../../lib/content/neon-content-dev-fixture-job.ts';
import {createRestrictedContentJobDb} from '../../lib/content/neon-content-generation-job-restricted-db.ts';
import {claimContentJob, finishContentJob, reclaimExpiredContentJob} from '../../lib/content/neon-content-generation-job-lifecycle.ts';

function disposablePool(variable, role) {
  const url = new URL(process.env[variable]);
  assert.ok(process.env.CONTENT_PG_INTEGRATION_CI === 'disposable_only' &&
    url.username === role && url.host === '127.0.0.1:5432' && url.pathname === '/bros_intelligence_dev',
    'Expected the disposable PostgreSQL fixture');
  return new pg.Pool({connectionString: url.href, max: 3});
}
const admin = disposablePool('CONTENT_ADMIN_DB_URL', 'postgres');
const writer = disposablePool('CONTENT_JOB_WRITER_DB_URL', 'content_dev_job_writer_v2');
const worker = disposablePool('CONTENT_JOB_WORKER_DB_URL', 'content_dev_job_worker_v2');
after(() => Promise.all([admin, writer, worker].map(pool => pool.end())));

const workspaceId = '22222222-2222-4222-8222-222222222222';
const tenantId = '33333333-3333-4333-8333-333333333333';
const principal = {userId: '8ae086ff-3f10-4863-b5e7-4b67e062024d', authenticated: true};
const otherPrincipal = {userId: '11111111-1111-4111-8111-111111111111', authenticated: true};
const otherTenant = '66666666-6666-4666-8666-666666666666';
const url = 'http://127.0.0.1/api/content/dev/workspaces/' + workspaceId + '/generation-jobs';
const submit = createPooledContentJobSubmitter(writer);

async function newCampaign() {
  const {rows} = await admin.query(`INSERT INTO content_dev.campaigns
    (tenant_id,workspace_id,owner_principal_id,product_service,audience,duration_days)
    VALUES ($1,$2,$3,'Restricted job fixture','Internal',7) RETURNING id`, [tenantId,workspaceId,principal.userId]);
  return rows[0].id;
}
function post(campaignId, idempotencyKey, identity = principal, origin = new URL(url).origin) {
  const request = new Request(url, {method:'POST', headers:{origin,'content-type':'application/json'},
    body:JSON.stringify({campaignId,idempotencyKey})});
  return createContentJobPost(async () => identity, submit)(request,workspaceId);
}
async function storedJob(id) {
  const {rows} = await admin.query(`SELECT j.status,j.attempts,j.error_code,
    (SELECT count(*)::int FROM content_dev.content_items i
      WHERE i.tenant_id=j.tenant_id AND i.campaign_id=j.campaign_id AND i.body->'provenance'->>'job_id'=j.id::text) AS outputs
    FROM content_dev.generation_jobs j WHERE id=$1`, [id]);
  return rows[0];
}

test('authenticated submission deduplicates concurrent requests and returns a bounded receipt', async () => {
  const campaignId = await newCampaign();
  const key = randomUUID();
  const responses = await Promise.all([post(campaignId,key),post(campaignId,key)]);
  assert.deepEqual(responses.map(r => r.status),[202,202]);
  const [{data: first},{data: replay}] = await Promise.all(responses.map(r => r.json()));
  assert.deepEqual(first,replay);
  assert.deepEqual(Object.keys(first).sort(), ['attempts','campaignId','id','status']);
  assert.equal((await post(await newCampaign(),key)).status,409);
  assert.equal((await post(campaignId,key,otherPrincipal)).status,404);
  assert.equal((await post(campaignId,key,null)).status,401);
  assert.equal((await post(campaignId,key,principal,'https://other.example.test')).status,403);
  assert.equal((await processContentFixtureJob({pool:worker,tenantId:otherTenant,jobId:first.id})).state,'unavailable');
  const results = await Promise.all([1,2].map(() => processContentFixtureJob({pool:worker,tenantId,jobId:first.id})));
  assert.deepEqual(results.map(r => r.state).sort(),['completed','unavailable']);
  assert.deepEqual(await storedJob(first.id),{status:'completed',attempts:1,error_code:null,outputs:1});
  const finalReplay = await (await post(campaignId,key)).json();
  assert.equal(finalReplay.data.id,first.id);
  assert.equal(finalReplay.data.status,'completed');
  const next = await post(campaignId,randomUUID());
  assert.equal(next.status,409);
  assert.deepEqual(await next.json(),{error:'campaign_not_eligible'});
  assert.deepEqual(await storedJob(first.id),{status:'completed',attempts:1,error_code:null,outputs:1});
});

test('revoking campaign ownership closes replay, claim and completion, preserving prior rows', async () => {
  const campaignId = await newCampaign();
  const key = randomUUID();
  const queued = await submit(principal,{workspaceId,campaignId,idempotencyKey:key});
  const runningCampaign = await newCampaign();
  const running = await submit(principal,{workspaceId,campaignId:runningCampaign,idempotencyKey:randomUUID()});
  const db = createRestrictedContentJobDb({pool:worker, purpose:'worker', tenantId});
  assert.equal((await claimContentJob(db,{tenantId,jobId:running.id})).attempts,1);
  await admin.query('UPDATE content_dev.campaigns SET owner_principal_id=$2 WHERE id IN ($1,$3)',[campaignId,otherPrincipal.userId,runningCampaign]);
  assert.equal((await post(campaignId,key)).status,404);
  assert.equal(await claimContentJob(db,{tenantId,jobId:queued.id}),null);
  assert.equal(await finishContentJob(db,{tenantId,jobId:running.id,attempt:1,outcome:'completed'}),null);
  assert.deepEqual(await storedJob(queued.id),{status:'queued',attempts:0,error_code:null,outputs:0});
  assert.deepEqual(await storedJob(running.id),{status:'running',attempts:1,error_code:null,outputs:0});
});

test('lease recovery fences an obsolete attempt and commits only one output', async () => {
  const campaignId = await newCampaign();
  const {id:jobId} = await submit(principal,{workspaceId,campaignId,idempotencyKey:randomUUID()});
  const db = createRestrictedContentJobDb({pool:worker, purpose:'worker', tenantId});
  assert.equal((await claimContentJob(db,{tenantId,jobId})).attempts,1);
  assert.equal(await reclaimExpiredContentJob(db,{tenantId,jobId,leaseSeconds:30}),null);
  await admin.query("UPDATE content_dev.generation_jobs SET claimed_at=now()-interval '1 hour' WHERE id=$1",[jobId]);
  const recovered = await processContentFixtureJob({pool:worker,tenantId,jobId,recoverExpired:true,leaseSeconds:30});
  assert.equal(recovered.state,'completed');
  assert.equal(await finishContentJob(db,{tenantId,jobId,attempt:1,outcome:'failed',errorCode:'STALE_ATTEMPT'}),null);
  assert.deepEqual(await storedJob(jobId),{status:'completed',attempts:2,error_code:null,outputs:1});
});

test('two fresh keys for one empty draft produce exactly one queued job', async () => {
  const campaignId = await newCampaign();
  const replies = await Promise.all([post(campaignId,randomUUID()),post(campaignId.toUpperCase(),randomUUID())]);
  assert.deepEqual(replies.map(r => r.status).sort(),[202,409]);
  const {rows} = await admin.query('SELECT status,attempts FROM content_dev.generation_jobs WHERE campaign_id=$1',[campaignId]);
  assert.deepEqual(rows,[{status:'queued',attempts:0}]);
});

test('pre-existing campaign strategy or child-only creative prevents new submission', async () => {
  const first = await newCampaign();
  const second = await newCampaign();
  await admin.query("UPDATE content_dev.campaigns SET strategy='{}'::jsonb WHERE id=$1",[first]);
  await admin.query(`INSERT INTO content_dev.content_items(tenant_id,campaign_id,type,title)
    VALUES ($1,$2,'other','Prior imported creative')`,[tenantId,second]);
  for (const campaignId of [first,second]) {
    const response = await post(campaignId,randomUUID());
    assert.equal(response.status,409);
    assert.deepEqual(await response.json(),{error:'campaign_not_eligible'});
  }
  const {rowCount} = await admin.query('SELECT id FROM content_dev.generation_jobs WHERE campaign_id IN ($1,$2)',[first,second]);
  assert.equal(rowCount,0);
});
