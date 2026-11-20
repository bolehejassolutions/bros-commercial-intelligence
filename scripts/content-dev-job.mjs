import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createContentCampaignPlanner} from '../lib/content/neon-content-generation-orchestrator.ts';
import {evaluateQualityGate, validateCampaignPlan, validateQualityReview} from '../lib/content/neon-content-generation-contract.ts';
import {processReviewedContentJob} from '../lib/content/neon-content-reviewed-job.ts';

const usage = 'npm run content:dev-job -- <tenant-uuid> <job-uuid> [reviewed-fixture.json]';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function run(args) {
  const [tenantId, jobId, fixture = new URL('./fixtures/content-dev-reviewed-plan.json', import.meta.url)] = args;
  if (args.length === 1 && tenantId === '--help') {
    console.log(usage);
    return 0;
  }
  if (args.length < 2 || args.length > 3 || !uuid.test(tenantId) || !uuid.test(jobId)) {
    console.error(usage);
    return 2;
  }
  const raw = process.env.CONTENT_JOB_PLAN_DB_URL;
  const db = raw && URL.canParse(raw) ? new URL(raw) : null;
  if (process.env.CONTENT_PG_INTEGRATION_CI !== 'disposable_only' ||
      db?.protocol !== 'postgresql:' || db.hostname !== '127.0.0.1' || db.port !== '5432' ||
      db.pathname !== '/bros_intelligence_dev' || db.username !== 'content_dev_job_plan_worker_v1' ||
      !db.password || db.search || db.hash) {
    console.error('Set the disposable database marker and the loopback plan-worker URL from the CONTENT fixture.');
    return 2;
  }
  let plan, review;
  try {
    const input = JSON.parse(await readFile(fixture, 'utf8'));
    plan = validateCampaignPlan(input.plan);
    review = validateQualityReview(input.review);
    if (!evaluateQualityGate(review).accepted) throw new Error();
  } catch {
    console.error('The input must be a readable JSON fixture containing a valid plan and accepted review.');
    return 2;
  }
  const planCampaign = createContentCampaignPlanner(async (_prompt, _schema, name) =>
    name === 'bros_campaign' ? plan : review);
  const pool = new pg.Pool({connectionString: db.href, max: 1, connectionTimeoutMillis: 5000});
  try {
    const {state} = await processReviewedContentJob({pool, tenantId, jobId, planCampaign});
    console.log(JSON.stringify({jobId, state}));
    return state === 'completed' || state === 'unavailable' ? 0 : 1;
  } finally {
    await pool.end();
  }
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch {
  console.error('The restricted database operation failed. Check the disposable fixture and job history.');
  process.exitCode = 1;
}
