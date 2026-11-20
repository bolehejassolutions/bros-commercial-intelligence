/** Restricted CONTENT DEV job transactions. The caller provides one direct-login
 * pool per purpose. No role or policy is installed by these adapters. */
import type {JobQuery} from './neon-content-generation-job-lifecycle.ts';
import {createContentTransaction} from './neon-content-transaction.ts';

export type JobPool = Parameters<typeof createContentTransaction>[0];
export type JobPrincipal = Readonly<{userId:string; authenticated:true}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = {submit:'content_dev_job_writer_v2', history:'content_dev_reader_v2', worker:'content_dev_job_worker_v2'} as const;

type Scope = {
 pool: JobPool;
 purpose: keyof typeof ROLES;
 tenantId?: string;
 principal?: JobPrincipal;
};
type Query = Parameters<Parameters<ReturnType<typeof createContentTransaction>>[0]>[0];

export function restrictedContentJobTransaction({pool, purpose, tenantId, principal}: Scope) {
 if (!ROLES[purpose] || (tenantId !== undefined && !UUID.test(tenantId)) ||
     (purpose !== 'worker' && (!principal || principal.authenticated !== true || !UUID.test(principal.userId))) ||
     (!tenantId && purpose !== 'submit') || (purpose === 'worker' && principal !== undefined))
  throw new Error('Invalid CONTENT job adapter scope');
 const transaction = createContentTransaction(pool);
 return async <T>(run: (query: Query) => Promise<T>) => transaction(async query => {
  const [role] = (await query(`SELECT current_user AS name, session_user AS login,
   rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper AND NOT rolcreaterole
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS restricted
   FROM pg_roles WHERE rolname=current_user`, [])).rows;
  if (role?.name !== ROLES[purpose] || role.login !== role.name || role.restricted !== true)
   throw new Error('Restricted CONTENT role unavailable');
  const [posture] = (await query(`SELECT current_database() AS db,
   has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging,
   has_table_privilege(current_user,'content_dev.credit_ledger','SELECT,INSERT,UPDATE,DELETE') AS credits,
   has_table_privilege(current_user,'content_dev.generation_jobs','INSERT') AS submit,
   has_any_column_privilege(current_user,'content_dev.generation_jobs','UPDATE') AS worker,
   has_any_column_privilege(current_user,'content_dev.campaigns','INSERT,UPDATE') AS campaigns_write,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='content_dev' AND c.relname IN ('campaigns','workspaces','generation_jobs','content_items')
     AND c.relrowsecurity AND c.relforcerowsecurity) AS forced`, [])).rows;
  if (posture?.db !== 'bros_intelligence_dev' || posture.staging !== false || posture.credits !== false ||
      posture.submit !== (purpose === 'submit') || posture.worker !== (purpose === 'worker') ||
      posture.campaigns_write !== false || posture.forced !== 4)
   throw new Error('CONTENT job database posture denied');
  if (principal) await query("SELECT set_config('bci.principal_id',$1,true)", [principal.userId]);
  await query("SELECT set_config('content.tenant_id',$1,true)", [tenantId ?? '']);
  return run(query);
 });
}

/** Lifecycle SQL returns job rows. Affected-row counts are never used as receipts. */
export function jobQuery(query: Query): JobQuery {
 return {async query(sql, params = []) {
  const {rows} = await query(sql, params);
  return {rows: [...rows] as Awaited<ReturnType<JobQuery['query']>>['rows']};
 }};
}

export function createRestrictedContentJobDb(input: Scope & {tenantId:string}): JobQuery {
 const transaction = restrictedContentJobTransaction(input);
 return {query: (sql, params) => transaction(query => jobQuery(query).query(sql, params))};
}
