import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {
  evaluateQualityGate, validateCampaignInput, validateCampaignPlan, validateQualityReview,
} from '../lib/content/neon-content-generation-contract.ts';
import {createContentCampaignPlanner} from '../lib/content/neon-content-generation-orchestrator.ts';
import {restrictedContentJobTransaction} from '../lib/content/neon-content-generation-job-restricted-db.ts';
import {processReviewedContentJob} from '../lib/content/neon-content-reviewed-job.ts';

// Direct compute of br-broad-math-b3f4d2r4 in empty-tooth-43040036.
const host = 'ep-fancy-queen-b30g0cjn.c-4.ap-southeast-1.aws.neon.tech';
const user = 'content_dev_job_plan_worker_v1';
const database = 'bros_intelligence_dev';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const usage = 'npm run content:hosted-dev-job -- <tenant-uuid> <job-uuid> <reviewed-job.json>\n' +
  'npm run content:hosted-dev-job -- --check <tenant-uuid>';

class InputError extends Error {}

function connection(env) {
  const raw = env.CONTENT_HOSTED_DEV_PLAN_DATABASE_URL;
  const db = raw && URL.canParse(raw) ? new URL(raw) : null;
  if (env.CONTENT_HOSTED_DEV_WORKER_ENABLED !== 'true' || env.VERCEL_ENV === 'production' ||
      !db || db.protocol !== 'postgresql:' || db.hostname !== host || (db.port && db.port !== '5432') ||
      db.username !== user || !db.password || db.pathname !== '/' + database ||
      !['?sslmode=require','?sslmode=verify-full'].includes(db.search) || db.hash)
    throw new InputError('Expected an enabled hosted DEV worker and its direct, restricted TLS login.');
  // Pass fields individually so a URI option cannot replace TLS verification.
  return {host, port:5432, database, user, password:decodeURIComponent(db.password),
    ssl:{rejectUnauthorized:true, servername:host}, max:1, connectionTimeoutMillis:5000};
}

async function reviewedPlanner(file, tenantId, jobId) {
  try {
    const packet = JSON.parse(await readFile(file, 'utf8'));
    if (packet.tenantId !== tenantId || packet.jobId !== jobId || !Object.hasOwn(packet, 'businessDna'))
      throw new Error();
    const brief = validateCampaignInput(packet.brief);
    const plan = validateCampaignPlan(packet.plan);
    const review = validateQualityReview(packet.review);
    if (!evaluateQualityGate(review).accepted) throw new Error();
    const prepare = createContentCampaignPlanner(async (_prompt, _schema, name) =>
      name === 'bros_campaign' ? plan : review);
    return async (savedBrief, savedDna) => {
      if (!isDeepStrictEqual(savedBrief, brief) || !isDeepStrictEqual(savedDna, packet.businessDna))
        throw new Error('The reviewed inputs have changed.');
      return prepare(savedBrief, savedDna);
    };
  } catch {
    throw new InputError('Expected an accepted review and saved inputs for the specified tenant and job.');
  }
}

export async function runHostedContentJob(args, env, openPool = config => new pg.Pool(config)) {
  const check = args[0] === '--check';
  const tenantId = check ? args[1] : args[0];
  const jobId = args[1];
  if (!uuid.test(tenantId) || (check ? args.length !== 2 : args.length !== 3 || !uuid.test(jobId)))
    throw new InputError(usage);
  const config = connection(env);
  const planCampaign = check ? null : await reviewedPlanner(args[2], tenantId, jobId);
  const pool = openPool(config);
  try {
    if (check) {
      const transaction = restrictedContentJobTransaction({pool, tenantId, purpose:'planWorker'});
      await transaction(async () => {});
      return {state:'restricted_login_verified'};
    }
    const {state} = await processReviewedContentJob({pool, tenantId, jobId, planCampaign});
    return {jobId, state};
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
  } else {
    try {
      const receipt = await runHostedContentJob(args, process.env);
      console.log(JSON.stringify(receipt));
      if (receipt.state === 'failed' || receipt.state === 'lost_lease') process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof InputError ? error.message : 'Hosted DEV worker failed. Check the restricted login and job history.');
      process.exitCode = error instanceof InputError ? 2 : 1;
    }
  }
}
