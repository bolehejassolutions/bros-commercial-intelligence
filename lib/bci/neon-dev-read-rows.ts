/**
 * Parameterized, transactional SQL adapter for BCI's internal Neon DEV evidence.
 *
 * Not a public API. The caller MUST supply a server-only transaction executor
 * directly authenticated as SQL-created bci_dev_private_reader (not admin/BROS).
 * Both session_user and current_user must equal this restricted LOGIN role:
 * an admin SET ROLE impersonation is NOT proof of a restricted login.
 * A caller-supplied tenant ID is not acceptable: compose ONLY after a
 * verified principal + authoritative tenant-membership check.
 */
import {
  PrivateEvidenceAccessDenied,
  type BciProduct,
  type EvidenceRow,
} from "./private-evidence-boundary.ts";

type SqlValue = string | number | boolean | null;
type SqlResult = Readonly<{ rows: readonly unknown[] }>;
type Query = (sql: string, params: readonly SqlValue[]) => Promise<SqlResult>;
export type ScopedTransaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;

type Scope = Readonly<{ tenantId: string; product: BciProduct; limit: number }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (): never => { throw new PrivateEvidenceAccessDenied(); };
const isObject = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

/** Requires a single pinned physical Postgres transaction; no HTTP one-shot driver. */
export function createNeonDevReadRows(transaction: ScopedTransaction) {
  if (typeof transaction !== "function") deny();
  return async (scope: Scope): Promise<readonly EvidenceRow[]> => {
    if (!scope || !UUID.test(scope.tenantId) ||
        (scope.product !== "content" && scope.product !== "demand") ||
        !Number.isInteger(scope.limit) || scope.limit < 1 || scope.limit > 50) deny();

    return transaction(async (query) => {
      const role = await query(
        `SELECT current_user AS role_name, session_user AS session_role_name, rolbypassrls AS bypass_rls, rolsuper AS is_superuser, rolcanlogin AS can_login,
                rolcreatedb AS can_create_database, rolcreaterole AS can_manage_roles,
                rolreplication AS can_replicate, rolinherit AS inherits_roles,
                (SELECT COUNT(*)::integer FROM pg_auth_members m WHERE m.member = pg_roles.oid) AS parent_role_count FROM pg_roles WHERE rolname = current_user`,
        []
      );
      if (role.rows.length !== 1 || !isObject(role.rows[0]) ||
          role.rows[0].role_name !== "bci_dev_private_reader" ||
          role.rows[0].session_role_name !== "bci_dev_private_reader" ||
          role.rows[0].bypass_rls !== false ||
          role.rows[0].is_superuser !== false ||
          role.rows[0].can_login !== true ||
          role.rows[0].can_create_database !== false ||
          role.rows[0].can_manage_roles !== false ||
          role.rows[0].can_replicate !== false ||
          role.rows[0].inherits_roles !== false ||
          role.rows[0].parent_role_count !== 0) deny();

      // Verify the actual connection target and least-privilege posture before
      // setting any request scope. This detects accidentally wired databases,
      // missing RLS, and privilege drift; it does NOT verify HTTP identity.
      const posture = await query(
        `SELECT current_database() AS database_name,
                c.relrowsecurity AS rls_enabled,
                c.relforcerowsecurity AS rls_forced,
                has_table_privilege(current_user, 'bci_dev.evidence', 'SELECT') AS can_read_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'INSERT') AS can_insert_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'UPDATE') AS can_update_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'DELETE') AS can_delete_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'TRUNCATE') AS can_truncate_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'REFERENCES') AS can_reference_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'TRIGGER') AS can_trigger_evidence,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'SELECT') AS can_read_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'INSERT') AS can_insert_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'UPDATE') AS can_update_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'DELETE') AS can_delete_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'TRUNCATE') AS can_truncate_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'REFERENCES') AS can_reference_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'TRIGGER') AS can_trigger_memberships,
                has_schema_privilege(current_user, 'bci_dev', 'CREATE') AS can_create_schema_objects,
                has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,
                (SELECT NOT EXISTS (
                    SELECT 1 FROM pg_proc proc JOIN pg_namespace proc_ns ON proc_ns.oid = proc.pronamespace
                    WHERE proc_ns.nspname = 'bci_dev' AND proc.prosecdef
                      AND has_function_privilege(current_user, proc.oid, 'EXECUTE')
                )) AS no_definer_exec,
                (SELECT NOT EXISTS (
                    SELECT 1 FROM pg_proc external_proc
                    JOIN pg_namespace external_ns ON external_ns.oid = external_proc.pronamespace
                    WHERE external_ns.nspname <> 'bci_dev'
                      AND external_ns.nspname <> 'information_schema'
                      AND LEFT(external_ns.nspname, 3) <> 'pg_'
                      AND external_proc.prosecdef
                      AND has_function_privilege(current_user, external_proc.oid, 'EXECUTE')
                )) AS no_external_definer_exec,
                (SELECT NOT EXISTS (
                    SELECT 1 FROM pg_namespace external_schema
                    WHERE external_schema.nspname <> 'bci_dev'
                      AND external_schema.nspname <> 'information_schema'
                      AND LEFT(external_schema.nspname, 3) <> 'pg_'
                      AND has_schema_privilege(current_user, external_schema.oid, 'CREATE')
                )) AS no_external_schema_create,
                (SELECT NOT EXISTS (
                    SELECT 1 FROM pg_class outside_table
                    JOIN pg_namespace outside_ns ON outside_ns.oid = outside_table.relnamespace
                    WHERE outside_ns.nspname <> 'bci_dev'
                      AND outside_ns.nspname <> 'information_schema'
                      AND LEFT(outside_ns.nspname, 3) <> 'pg_'
                      AND outside_table.relkind IN ('r','p','v','m','f')
                      AND has_table_privilege(current_user, outside_table.oid,
                        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                )) AS no_external_table_access,
                (SELECT COUNT(*) = 3 AND bool_and(
                    extra.relrowsecurity AND extra.relforcerowsecurity AND
                    has_table_privilege(current_user, extra.oid, 'SELECT') AND
                    NOT has_table_privilege(current_user, extra.oid,
                      'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
                 FROM pg_class extra JOIN pg_namespace extra_ns ON extra_ns.oid = extra.relnamespace
                 WHERE extra_ns.nspname = 'bci_dev'
                   AND extra.relname IN ('cases', 'case_evidence', 'proposals')
                   AND extra.relkind IN ('r', 'p')) AS lineage_tables_readonly
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'bci_dev' AND c.relname = 'evidence' AND c.relkind IN ('r', 'p')`,
        []
      );
      if (posture.rows.length !== 1 || !isObject(posture.rows[0]) ||
          posture.rows[0].database_name !== "bros_intelligence_dev" ||
          posture.rows[0].rls_enabled !== true ||
          posture.rows[0].rls_forced !== true ||
          posture.rows[0].can_read_evidence !== true ||
          posture.rows[0].can_insert_evidence !== false ||
          posture.rows[0].can_update_evidence !== false ||
          posture.rows[0].can_delete_evidence !== false ||
          posture.rows[0].can_truncate_evidence !== false ||
          posture.rows[0].can_reference_evidence !== false ||
          posture.rows[0].can_trigger_evidence !== false ||
          posture.rows[0].can_read_memberships !== false ||
          posture.rows[0].can_insert_memberships !== false ||
          posture.rows[0].can_update_memberships !== false ||
          posture.rows[0].can_delete_memberships !== false ||
          posture.rows[0].can_truncate_memberships !== false ||
          posture.rows[0].can_reference_memberships !== false ||
          posture.rows[0].can_trigger_memberships !== false ||
          posture.rows[0].can_create_schema_objects !== false ||
          posture.rows[0].can_create_database_objects !== false ||
          posture.rows[0].no_definer_exec !== true ||
          posture.rows[0].no_external_definer_exec !== true ||
          posture.rows[0].no_external_schema_create !== true ||
          posture.rows[0].no_external_table_access !== true ||
          posture.rows[0].lineage_tables_readonly !== true) deny();

      // Scope is derived upstream from trusted membership, not request data.
      // set_config(...,true) binds tenant AND product transaction-locally; never share the session with a
      // second request or run this on an unpinned connection/pooled HTTP call.
      await query(
        "SELECT set_config('bci.tenant_id', $1::text, true) AS tenant_scope, set_config('bci.product', $2::text, true) AS product_scope",
        [scope.tenantId, scope.product]
      );
      const response = await query(
        `SELECT id::text AS "id", tenant_id::text AS "tenantId", product, provider,
                provider_record_key AS "providerRecordKey", metrics
         FROM bci_dev.evidence
         WHERE tenant_id = $1::uuid AND product = $2::text
         ORDER BY observed_at DESC, id DESC LIMIT $3::integer`,
        [scope.tenantId, scope.product, scope.limit]
      );
      if (response.rows.length > scope.limit) deny();
      return response.rows.map((value) => {
        if (!isObject(value)) throw new PrivateEvidenceAccessDenied();
        if (value.tenantId !== scope.tenantId || value.product !== scope.product ||
            typeof value.id !== "string" || !UUID.test(value.id) ||
            typeof value.provider !== "string" ||
            typeof value.providerRecordKey !== "string" || !isObject(value.metrics)) {
          throw new PrivateEvidenceAccessDenied();
        }
        const id = value.id;
        const provider = value.provider;
        const providerRecordKey = value.providerRecordKey;
        const rawMetrics = value.metrics;
        const metricEntries = Object.entries(rawMetrics);
        if (metricEntries.length > 100) throw new PrivateEvidenceAccessDenied();
        const metrics: Record<string, number | null> = {};
        for (const [key, raw] of metricEntries) {
          if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) throw new PrivateEvidenceAccessDenied();
          if (raw === null) metrics[key] = null;
          else if (typeof raw === "number" && Number.isFinite(raw)) metrics[key] = raw;
          else throw new PrivateEvidenceAccessDenied();
        }
        return {
          id,
          tenantId: scope.tenantId,
          product: scope.product,
          provider,
          providerRecordKey,
          metrics,
        };
      });
    });
  };
}
