/** Restricted CONTENT DEV job transactions. The caller provides one direct-login
 * pool per purpose. No role or policy is installed by these adapters. */
import type {JobQuery} from './neon-content-generation-job-lifecycle.ts';
import {createContentTransaction} from './neon-content-transaction.ts';

export type JobPool = Parameters<typeof createContentTransaction>[0];
export type JobPrincipal = Readonly<{userId:string; authenticated:true}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = {submit:'content_dev_job_writer_v2', history:'content_dev_reader_v2', worker:'content_dev_job_worker_v2', planWorker:'content_dev_job_plan_worker_v1'} as const;

type Scope = {
 pool: JobPool;
 purpose: keyof typeof ROLES;
 tenantId?: string;
 principal?: JobPrincipal;
};
export type JobTransactionQuery = Parameters<Parameters<ReturnType<typeof createContentTransaction>>[0]>[0];

export function restrictedContentJobTransaction({pool, purpose, tenantId, principal}: Scope) {
 const isWorker = purpose === 'worker' || purpose === 'planWorker';
 if (!ROLES[purpose] || (tenantId !== undefined && !UUID.test(tenantId)) ||
     (!isWorker && (!principal || principal.authenticated !== true || !UUID.test(principal.userId))) ||
     (!tenantId && purpose !== 'submit') || (isWorker && principal !== undefined))
  throw new Error('Invalid CONTENT job adapter scope');
 const transaction = createContentTransaction(pool);
 return async <T>(run: (query: JobTransactionQuery) => Promise<T>) => transaction(async query => {
  const [role] = (await query(`SELECT current_user AS name, session_user AS login,
   rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS restricted
   FROM pg_roles WHERE rolname=current_user`, [])).rows;
  if (role?.name !== ROLES[purpose] || role.login !== role.name || role.restricted !== true)
   throw new Error('Restricted CONTENT role unavailable');
  const [posture] = (await query(`SELECT current_database() AS db,
   has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging,
   has_table_privilege(current_user,'content_dev.credit_ledger','SELECT,INSERT,UPDATE,DELETE') AS credits,
   has_table_privilege(current_user,'content_dev.generation_jobs','INSERT') AS submit,
   has_any_column_privilege(current_user,'content_dev.generation_jobs','UPDATE') AS worker,
   has_any_column_privilege(current_user,'content_dev.campaigns','INSERT') AS campaigns_insert,
   has_table_privilege(current_user,'content_dev.campaigns','DELETE,TRUNCATE') AS campaigns_delete,
   ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid='content_dev.campaigns'::regclass
    AND attnum>0 AND NOT attisdropped AND has_column_privilege(current_user,attrelid,attnum,'UPDATE')
    ORDER BY attname) AS campaign_updates,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='content_dev' AND c.relname IN ('campaigns','workspaces','generation_jobs','content_items','scenes')
     AND c.relrowsecurity AND c.relforcerowsecurity) AS forced`, [])).rows;
  const columns = purpose === 'planWorker' ? ['angles','captions','publish_plan','strategy'] : [];
  if (posture?.db !== 'bros_intelligence_dev' || posture.staging !== false || posture.credits !== false ||
      posture.submit !== (purpose === 'submit') || posture.worker !== isWorker ||
      posture.campaigns_insert !== false || posture.campaigns_delete !== false ||
      JSON.stringify(posture.campaign_updates) !== JSON.stringify(columns) || posture.forced !== 5)
   throw new Error('CONTENT job database posture denied');
  if (principal) await query("SELECT set_config('bci.principal_id',$1,true)", [principal.userId]);
  await query("SELECT set_config('content.tenant_id',$1,true)", [tenantId ?? '']);
  return run(query);
 });
}

/** Lifecycle SQL returns job rows. Affected-row counts are never used as receipts. */
export function jobQuery(query: JobTransactionQuery): JobQuery {
 return {async query(sql, params = []) {
  const {rows} = await query(sql, params);
  return {rows: [...rows] as Awaited<ReturnType<JobQuery['query']>>['rows']};
 }};
}

export function createRestrictedContentJobDb(input: Scope & {tenantId:string}): JobQuery {
 const transaction = restrictedContentJobTransaction(input);
 return {query: (sql, params) => transaction(query => jobQuery(query).query(sql, params))};
}
