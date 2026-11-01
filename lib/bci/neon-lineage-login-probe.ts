/** Authenticated DEV-only physical lineage LOGIN probe. Every SQL operation is READ ONLY. */
import type { ScopedTransaction } from "./neon-dev-read-rows.ts";
import { EXPECTED_LINEAGE_POLICY_FINGERPRINTS } from "./neon-lineage-writer.ts";

type Scope = Readonly<{ principalId: string; tenantId: string; product: "demand" }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT = "4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const FOREIGN_TENANT = "00000000-0000-4000-8000-000000000000";
const FOREIGN_TENANT_2 = "ffffffff-ffff-4fff-bfff-ffffffffffff";
const FOREIGN_PRINCIPAL = "00000000-0000-4000-8000-000000000001";
const FOREIGN_PRINCIPAL_2 = "ffffffff-ffff-4fff-bfff-fffffffffff1";
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export class BciLineageLoginProbeDenied extends Error {
  constructor() { super("BCI restricted lineage login probe denied."); this.name = "BciLineageLoginProbeDenied"; }
}
const deny = (): never => { throw new BciLineageLoginProbeDenied(); };
export type BciLineageLoginProbeResult = Readonly<{
  directLineageLoginVerified: true;
  leastPrivilegeAndForcedRlsVerified: true;
  activeMembershipVerified: true;
  nonemptyLineageIsolationVerified: true;
  negativeTenantPrincipalProductVerified: true;
  revokedFixturePrincipalDenied: true;
  lineageAppended: false;
}>;
export function createRestrictedLineageReadOnlyProbe(transaction: ScopedTransaction) {
  if (typeof transaction !== "function") deny();
  return async (scope: Scope): Promise<BciLineageLoginProbeResult> => {
    if (!obj(scope) || Reflect.ownKeys(scope).length !== 3 ||
        !Object.hasOwn(scope, "principalId") || !Object.hasOwn(scope, "tenantId") ||
        !Object.hasOwn(scope, "product") || typeof scope.principalId !== "string" ||
        typeof scope.tenantId !== "string" || !UUID.test(scope.principalId) ||
        !UUID.test(scope.tenantId) || scope.product !== "demand") deny();
    const principalId = scope.principalId.toLowerCase(), tenantId = scope.tenantId.toLowerCase();
    const otherTenant = tenantId === FOREIGN_TENANT ? FOREIGN_TENANT_2 : FOREIGN_TENANT;
    const otherPrincipal = principalId === FOREIGN_PRINCIPAL ? FOREIGN_PRINCIPAL_2 : FOREIGN_PRINCIPAL;
    try {
      return await transaction(async query => {
        const identity = await query(`SELECT current_user AS "roleName", session_user AS "sessionRoleName",
            rolcanlogin AS "canLogin", rolinherit AS "inherits", rolsuper AS "superuser",
            rolbypassrls AS "bypassRls", rolcreaterole AS "canCreateRole",
            rolcreatedb AS "canCreateDb", rolreplication AS "canReplicate",
            (SELECT COUNT(*)::integer FROM pg_auth_members m WHERE m.member=r.oid) AS "parentRoles"
            FROM pg_roles r WHERE r.rolname=current_user`, []);
        const r = identity.rows[0];
        if (identity.rows.length !== 1 || !obj(r) ||
            r.roleName !== "bci_dev_lineage_writer" || r.sessionRoleName !== "bci_dev_lineage_writer" ||
            r.canLogin !== true || r.inherits !== false || r.superuser !== false ||
            r.bypassRls !== false || r.canCreateRole !== false || r.canCreateDb !== false ||
            r.canReplicate !== false || r.parentRoles !== 0) deny();
        const posture = await query(`SELECT current_database() AS "databaseName",
          (SELECT COUNT(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='bci_dev' AND c.relname IN ('lineage_nodes','lineage_edges','tenant_memberships')
               AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) AS "forcedTables",
          has_table_privilege(current_user,'bci_dev.lineage_nodes','SELECT') AS "readNodes",
          has_table_privilege(current_user,'bci_dev.lineage_nodes','INSERT') AS "insertNodes",
          has_table_privilege(current_user,'bci_dev.lineage_edges','SELECT') AS "readEdges",
          has_table_privilege(current_user,'bci_dev.lineage_edges','INSERT') AS "insertEdges",
          NOT has_table_privilege(current_user,'bci_dev.lineage_nodes','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noNodeMutation",
          NOT has_table_privilege(current_user,'bci_dev.lineage_edges','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noEdgeMutation",
          NOT has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS "noFullMembershipRead",
          (SELECT bool_and(has_column_privilege(current_user,'bci_dev.tenant_memberships',x.col,'SELECT'))
             FROM (VALUES ('principal_id'),('tenant_id'),('product'),('active'),('revoked_at')) x(col)) AS "membershipColumns",
          NOT has_table_privilege(current_user,'bci_dev.tenant_memberships','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noMembershipMutation",
          NOT has_table_privilege(current_user,'bci_dev.evidence','SELECT,INSERT,UPDATE,DELETE') AS "noEvidenceAccess",
          NOT has_table_privilege(current_user,'bci_dev.content_dispatch_approvals','SELECT,INSERT,UPDATE,DELETE') AS "noApprovalAccess",
          NOT has_schema_privilege(current_user,'bci_dev','CREATE') AS "noSchemaCreate",
          NOT has_database_privilege(current_user,current_database(),'CREATE') AS "noDbCreate",
          (SELECT COUNT(*)::integer FROM pg_policies p WHERE p.schemaname='bci_dev'
             AND p.tablename IN ('lineage_nodes','lineage_edges','tenant_memberships')
             AND ('bci_dev_lineage_writer'=ANY(p.roles) OR 'public'=ANY(p.roles))) AS "policyCount",
          (SELECT string_agg(p.policyname||':'||p.cmd||':'||array_to_string(p.roles,',')||':'||
              encode(sha256(convert_to(coalesce(p.qual,p.with_check),'UTF8')),'hex'),
              '|' ORDER BY p.tablename,p.policyname)
             FROM pg_policies p WHERE p.schemaname='bci_dev' AND p.policyname IN
              ('dev_writer_lineage_nodes_select','dev_writer_lineage_nodes_insert',
               'dev_writer_lineage_edges_select','dev_writer_lineage_edges_insert',
               'dev_writer_lineage_membership_select')) AS "policyFingerprints"`, []);
        const p = posture.rows[0];
        if (posture.rows.length !== 1 || !obj(p) ||
            p.databaseName !== "bros_intelligence_dev" || p.forcedTables !== 3 ||
            p.readNodes !== true || p.insertNodes !== true || p.readEdges !== true ||
            p.insertEdges !== true || p.noNodeMutation !== true || p.noEdgeMutation !== true ||
            p.noFullMembershipRead !== true || p.membershipColumns !== true ||
            p.noMembershipMutation !== true || p.noEvidenceAccess !== true ||
            p.noApprovalAccess !== true || p.noSchemaCreate !== true || p.noDbCreate !== true ||
            p.policyCount !== 5 || p.policyFingerprints !== EXPECTED_LINEAGE_POLICY_FINGERPRINTS) deny();
        const setScope = async (user: string, tenant: string, product: string) => {
          await query("SELECT set_config('bci.principal_id',$1,true),set_config('bci.tenant_id',$2,true),set_config('bci.product',$3,true)",
            [user, tenant, product]);
        };
        const membershipCount = async (subjectPrincipal = principalId): Promise<number> => {
          const result = await query(`SELECT COUNT(*)::integer AS "count"
            FROM bci_dev.tenant_memberships
            WHERE principal_id=$1::uuid AND tenant_id=$2::uuid
              AND product='demand' AND active IS TRUE AND revoked_at IS NULL`,
            [subjectPrincipal, tenantId]);
          const row = result.rows[0];
          if (result.rows.length !== 1 || !obj(row) || typeof row.count !== "number") deny();
          return (row as { count: number }).count;
        };
        // Real nonempty lineage must be visible only under the authorized scope.
        // Membership-only checks cannot certify row-level lineage isolation.
        const rootCount = async (): Promise<number> => {
          const result = await query(`SELECT COUNT(*)::integer AS "count"
            FROM bci_dev.lineage_nodes
            WHERE tenant_id=$1::uuid AND product='demand' AND stage='evidence'
              AND id=$2::uuid AND source_system='bci_dev.evidence'
              AND source_record_key=$2::text AND assertion_status='unverified'
              AND cardinality(parent_ids)=0`, [tenantId, RECEIPT]);
          const row = result.rows[0];
          if (result.rows.length !== 1 || !obj(row) || typeof row.count !== "number") deny();
          return row.count as number;
        };
        await setScope(principalId, tenantId, "demand");
        if (await membershipCount() !== 1 || await rootCount() !== 1) deny();
        await setScope(principalId, otherTenant, "demand");
        if (await membershipCount() !== 0 || await rootCount() !== 0) deny();
        await setScope(otherPrincipal, tenantId, "demand");
        if (await membershipCount() !== 0 || await rootCount() !== 0) deny();
        // Neon DEV contains an independently read-back revoked principal.
        // Query that principal itself, not just the operator under foreign GUC.
        if (otherPrincipal !== FOREIGN_PRINCIPAL) deny();
        if (await membershipCount(otherPrincipal) !== 0 || await rootCount() !== 0) deny();
        await setScope(principalId, tenantId, "content");
        if (await membershipCount() !== 0 || await rootCount() !== 0) deny();
        await setScope(principalId, tenantId, "demand");
        if (await membershipCount() !== 1 || await rootCount() !== 1) deny();
        return Object.freeze({ directLineageLoginVerified: true, leastPrivilegeAndForcedRlsVerified: true,
          activeMembershipVerified: true, nonemptyLineageIsolationVerified: true,
          negativeTenantPrincipalProductVerified: true,
          revokedFixturePrincipalDenied: true,
          lineageAppended: false });
      });
    } catch { return deny(); }
  };
}
