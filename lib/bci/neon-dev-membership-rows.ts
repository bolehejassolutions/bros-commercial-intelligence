/**
 * Preview-only authoritative membership lookup, separate from the evidence reader.
 *
 * The caller MUST pass the subject from a verified Neon Auth JWT, never a
 * userId, tenantId or product inferred from an untrusted header or request body.
 * A dedicated membership-only direct LOGIN connection is required; an admin
 * SET ROLE session is deliberately rejected. This is not an HTTP route or a
 * credential provider, and cannot be deployed until direct-login proof exists.
 *
 * PostgreSQL session GUCs are self-settable: the GUC below is a transaction
 * filter, NOT authentication or an independent security boundary.
 */

type Product = "content" | "demand";
type Value = string | number | boolean | null;
type Query = (sql: string, params: readonly Value[]) => Promise<Readonly<{ rows: readonly unknown[] }>>;
export type MembershipTransaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
export type VerifiedMembership = Readonly<{
  principalId: string;
  tenantId: string;
  product: Product;
  active: true;
}>;

export class NeonMembershipAccessDenied extends Error {
  constructor() {
    super("Neon membership access denied.");
    this.name = "NeonMembershipAccessDenied";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (): never => { throw new NeonMembershipAccessDenied(); };
const obj = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Returns only active, unrevoked, product-scoped memberships; never guesses a tenant. */
export function createNeonDevMembershipLookup(transaction: MembershipTransaction) {
  if (typeof transaction !== "function") deny();
  return async (verifiedPrincipalId: string, product: Product): Promise<readonly VerifiedMembership[]> => {
    if (typeof verifiedPrincipalId !== "string" || !UUID.test(verifiedPrincipalId) ||
        (product !== "content" && product !== "demand")) deny();
    return transaction(async (query) => {
      const identity = await query(
        `SELECT current_user AS role_name, session_user AS session_role_name,
                rolbypassrls AS bypass_rls, rolsuper AS is_superuser,
                rolcanlogin AS can_login,
                rolcreatedb AS can_create_database, rolcreaterole AS can_manage_roles,
                rolreplication AS can_replicate, rolinherit AS inherits_roles,
                (SELECT COUNT(*)::integer FROM pg_auth_members m WHERE m.member = pg_roles.oid) AS parent_role_count
         FROM pg_roles WHERE rolname = current_user`, []);
      if (identity.rows.length !== 1 || !obj(identity.rows[0]) ||
          identity.rows[0].role_name !== "bci_dev_membership_reader" ||
          identity.rows[0].session_role_name !== "bci_dev_membership_reader" ||
          identity.rows[0].bypass_rls !== false ||
          identity.rows[0].is_superuser !== false ||
          identity.rows[0].can_login !== true ||
          identity.rows[0].can_create_database !== false ||
          identity.rows[0].can_manage_roles !== false ||
          identity.rows[0].can_replicate !== false ||
          identity.rows[0].inherits_roles !== false ||
          identity.rows[0].parent_role_count !== 0) deny();

      const posture = await query(
        `SELECT current_database() AS database_name,
                c.relrowsecurity AS rls_enabled,
                c.relforcerowsecurity AS rls_forced,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'SELECT') AS can_read_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'INSERT') AS can_insert_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'UPDATE') AS can_update_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'DELETE') AS can_delete_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'TRUNCATE') AS can_truncate_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'REFERENCES') AS can_reference_memberships,
                has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'TRIGGER') AS can_trigger_memberships,
                has_table_privilege(current_user, 'bci_dev.evidence', 'SELECT') AS can_read_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'INSERT') AS can_insert_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'UPDATE') AS can_update_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'DELETE') AS can_delete_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'TRUNCATE') AS can_truncate_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'REFERENCES') AS can_reference_evidence,
                has_table_privilege(current_user, 'bci_dev.evidence', 'TRIGGER') AS can_trigger_evidence,
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
                    NOT has_table_privilege(current_user, extra.oid,
                      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
                 FROM pg_class extra JOIN pg_namespace extra_ns ON extra_ns.oid = extra.relnamespace
                 WHERE extra_ns.nspname = 'bci_dev'
                   AND extra.relname IN ('cases', 'case_evidence', 'proposals')
                   AND extra.relkind IN ('r', 'p')) AS other_bci_tables_denied
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'bci_dev' AND c.relname = 'tenant_memberships' AND c.relkind IN ('r', 'p')`, []);
      if (posture.rows.length !== 1 || !obj(posture.rows[0]) ||
          posture.rows[0].database_name !== "bros_intelligence_dev" ||
          posture.rows[0].rls_enabled !== true || posture.rows[0].rls_forced !== true ||
          posture.rows[0].can_read_memberships !== true ||
          posture.rows[0].can_insert_memberships !== false ||
          posture.rows[0].can_update_memberships !== false ||
          posture.rows[0].can_delete_memberships !== false ||
          posture.rows[0].can_truncate_memberships !== false ||
          posture.rows[0].can_reference_memberships !== false ||
          posture.rows[0].can_trigger_memberships !== false ||
          posture.rows[0].can_read_evidence !== false ||
          posture.rows[0].can_insert_evidence !== false ||
          posture.rows[0].can_update_evidence !== false ||
          posture.rows[0].can_delete_evidence !== false ||
          posture.rows[0].can_truncate_evidence !== false ||
          posture.rows[0].can_reference_evidence !== false ||
          posture.rows[0].can_trigger_evidence !== false ||
          posture.rows[0].can_create_schema_objects !== false ||
          posture.rows[0].can_create_database_objects !== false ||
          posture.rows[0].no_definer_exec !== true ||
          posture.rows[0].no_external_definer_exec !== true ||
          posture.rows[0].no_external_schema_create !== true ||
          posture.rows[0].no_external_table_access !== true ||
          posture.rows[0].other_bci_tables_denied !== true) deny();

      // The principal was cryptographically verified upstream. This GUC only
      // scopes this already-authorized server transaction, not the identity.
      await query("SELECT set_config('bci.principal_id', $1::text, true) AS principal_scope", [verifiedPrincipalId]);
      const found = await query(
        `SELECT principal_id::text AS "principalId", tenant_id::text AS "tenantId",
                product, active, revoked_at AS "revokedAt"
         FROM bci_dev.tenant_memberships
         WHERE principal_id = $1::uuid AND product = $2::text
           AND active IS TRUE AND revoked_at IS NULL
         ORDER BY tenant_id LIMIT 2`, [verifiedPrincipalId, product]);
      // Existing private reader allows exactly one tenant per product. Reject
      // ambiguous grants rather than choosing a tenant or leaking an array.
      if (found.rows.length > 1) deny();
      return Object.freeze(found.rows.map((row) => {
        if (!obj(row)) throw new NeonMembershipAccessDenied();
        if (row.principalId !== verifiedPrincipalId ||
            typeof row.tenantId !== "string" || !UUID.test(row.tenantId) ||
            row.product !== product || row.active !== true || row.revokedAt !== null) throw new NeonMembershipAccessDenied();
        return Object.freeze({ principalId: verifiedPrincipalId, tenantId: row.tenantId,
          product, active: true as const });
      }));
    });
  };
}
