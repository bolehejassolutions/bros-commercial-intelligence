/**
 * Private BROS Business OS — non-routed DEV authoritative membership contract.
 * Requires an already cryptographically verified subject from the SERVER's IdP,
 * a direct bci_dev_membership_reader LOGIN, and a pinned READ ONLY transaction.
 * No database pool, credentials, HTTP endpoint, JWT verifier or privileges here.
 * Transaction-local GUCs are not an identity proof.
 */
import type { BciProduct } from "./assistant-evidence-bridge.ts";

type Scalar = string | number | boolean | null;
type Query = (sql: string, params: readonly Scalar[]) => Promise<{ rows: readonly unknown[] }>;
export type MembershipTransaction = <T>(callback: (query: Query) => Promise<T>) => Promise<T>;
export type MembershipSelection = Readonly<{ tenantId: string; product: BciProduct }>;
export class BusinessOsMembershipUnavailable extends Error {
  constructor() { super("BROS Business OS DEV membership unavailable"); this.name = "BusinessOsMembershipUnavailable"; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (): never => { throw new BusinessOsMembershipUnavailable(); };
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const ROLE_SQL = [
  "SELECT current_user AS role_name, session_user AS session_role_name,",
  "rolbypassrls AS bypass_rls, rolsuper AS superuser, rolcanlogin AS can_login,",
  "rolinherit AS inherits_roles, rolcreaterole AS can_manage_roles,
  "rolcreatedb AS can_create_database, rolreplication AS can_replicate,"",
  "(SELECT COUNT(*)::integer FROM pg_auth_members m WHERE m.member=pg_roles.oid) AS parent_role_count",
  "FROM pg_roles WHERE rolname=current_user"
].join(" ");
const POSTURE_SQL = [
  "SELECT current_database() AS database_name, current_setting('transaction_read_only') AS read_only_mode,",
  "c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,",
  "has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS can_read_membership,",
  "has_table_privilege(current_user,'bci_dev.tenant_memberships','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS can_write_membership,",
  "has_table_privilege(current_user,'bci_dev.evidence','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS can_access_evidence,",
  "has_schema_privilege(current_user,'bci_dev','CREATE') AS can_create_schema_objects,",
  "has_database_privilege(current_user,current_database(),'CREATE') AS can_create_database_objects,",\n  "(SELECT NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace",\n  "WHERE p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE')",\n  "AND n.nspname NOT IN ('pg_catalog','information_schema')",\n  "AND LEFT(n.nspname,3)<>'pg_')) AS no_definer_exec,",\n  "(SELECT NOT EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace",\n  "WHERE n.nspname <> 'bci_dev' AND n.nspname <> 'information_schema'",\n  "AND LEFT(n.nspname,3)<>'pg_' AND t.relkind IN ('r','p','v','m','f')",\n  "AND has_table_privilege(current_user,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))",\n  ") AS no_external_table_access",
  "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
  "WHERE n.nspname='bci_dev' AND c.relname='tenant_memberships' AND c.relkind IN ('r','p')"
].join(" ");
const GRANT_SQL = [
  "SELECT principal_id::text AS principal_id,tenant_id::text AS tenant_id,product,active,revoked_at",
  "FROM bci_dev.tenant_memberships",
  "WHERE principal_id=$1::uuid AND tenant_id=$2::uuid AND product=$3::text",
  "AND active IS TRUE AND revoked_at IS NULL",
  "LIMIT 2"
].join(" ");

/**
 * Input subject MUST originate from a cryptographically validated, live
 * non-revoked server session; never from a request header/query/body.
 * No-scope/unknown/denied membership returns false, not an inferred grant.
 * Unexpected DB errors or posture drift throw (HTTP layer maps to generic 503).
 */
export function createBusinessOsDevMembershipChecker(transaction: MembershipTransaction) {
  if (typeof transaction !== "function") deny();
  return async (verifiedSubjectId: string, scope: MembershipSelection): Promise<boolean> => {
    if (typeof verifiedSubjectId !== "string" || !UUID.test(verifiedSubjectId) ||
        !scope || typeof scope.tenantId !== "string" || !UUID.test(scope.tenantId) ||
        (scope.product !== "content" && scope.product !== "demand")) deny();
    try {
      return await transaction(async query => {
        const roleResult = await query(ROLE_SQL, []);
        if (!Array.isArray(roleResult?.rows) || roleResult.rows.length !== 1 ||
            !object(roleResult.rows[0])) deny();
        const role = roleResult.rows[0] as Record<string, unknown>;
        if (role.role_name !== "bci_dev_membership_reader" ||
            role.session_role_name !== "bci_dev_membership_reader" ||
            role.bypass_rls !== false || role.superuser !== false ||
            role.can_login !== true || role.inherits_roles !== false ||
            role.can_manage_roles !== false || role.can_create_database !== false ||\n            role.can_replicate !== false || role.parent_role_count !== 0) deny();

        const postureResult = await query(POSTURE_SQL, []);
        if (!Array.isArray(postureResult?.rows) || postureResult.rows.length !== 1 ||
            !object(postureResult.rows[0])) deny();
        const posture = postureResult.rows[0] as Record<string, unknown>;
        if (posture.database_name !== "bros_intelligence_dev" ||
            posture.read_only_mode !== "on" || posture.rls_enabled !== true ||
            posture.rls_forced !== true || posture.can_read_membership !== true ||
            posture.can_write_membership !== false || posture.can_access_evidence !== false ||
            posture.can_create_schema_objects !== false ||
            posture.can_create_database_objects !== false ||\n            posture.no_definer_exec !== true || posture.no_external_table_access !== true) deny();

        // RLS uses these transaction-local scopes as a SECOND independent
        // filter. All identity and scope values are bound, never interpolated.
        const set = await query(
          "SELECT set_config('bci.principal_id',$1::text,true) AS principal_scope," +
          "set_config('bci.tenant_id',$2::text,true) AS tenant_scope," +
          "set_config('bci.product',$3::text,true) AS product_scope",
          [verifiedSubjectId, scope.tenantId, scope.product]
        );
        if (!Array.isArray(set?.rows) || set.rows.length !== 1 || !object(set.rows[0]) ||
            set.rows[0].principal_scope !== verifiedSubjectId ||
            set.rows[0].tenant_scope !== scope.tenantId ||
            set.rows[0].product_scope !== scope.product) deny();

        const result = await query(GRANT_SQL, [verifiedSubjectId, scope.tenantId, scope.product]);
        if (!Array.isArray(result?.rows) || result.rows.length > 1) deny();
        if (result.rows.length === 0) return false;
        const row = result.rows[0];
        if (!object(row) || row.principal_id !== verifiedSubjectId ||
            row.tenant_id !== scope.tenantId || row.product !== scope.product ||
            row.active !== true || row.revoked_at !== null) deny();
        return true;
      });
    } catch {
      throw new BusinessOsMembershipUnavailable();
    }
  };
}
