/**
 * DEV-only direct LOGIN smoke for the already-approved SQL-native BCI writer.
 * Runs ONLY in a restricted physical PostgreSQL session inside READ ONLY.
 * Requires a signed Neon operator JWT + authoritative DEMAND membership upstream.
 * Never returns identifiers, row contents, provider secrets or connection details.
 *
 * This is a login/privilege/RLS smoke, NOT a provider receipt, authenticated
 * external attestation, DB append proof, or cross-tenant end-to-end acceptance.
 */
import type { ScopedTransaction } from "./neon-dev-read-rows.ts";
import { assertRestrictedEvidenceWriterPolicies } from "./neon-evidence-writer-policy-fingerprint.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_ROLE="bci_dev_evidence_writer_restricted";
const ALT_TENANT="00000000-0000-4000-8000-000000000000";
const ALT_TENANT_2="ffffffff-ffff-4fff-bfff-ffffffffffff";
const obj=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export class BciEvidenceWriterProbeDenied extends Error {
  constructor(){super("BCI evidence writer login probe denied.");this.name="BciEvidenceWriterProbeDenied";}
}
const deny=():never=>{throw new BciEvidenceWriterProbeDenied();};
type Scope=Readonly<{principalId:string;tenantId:string;product:"demand"}>;
export type RestrictedEvidenceWriterProbeResult=Readonly<{
  directRestrictedLoginVerified:true;
  forcedRlsAndPrivilegesVerified:true;
  activeDemandMembershipVerified:true;
  readOnlyScopeSmokeVerified:true;
  evidenceAppended:false;
  authenticatedProviderReceiptRecorded:false;
}>;

export function createRestrictedEvidenceWriterReadOnlyProbe(transaction:ScopedTransaction) {
  if(typeof transaction!=="function")deny();
  return async(scope:Scope):Promise<RestrictedEvidenceWriterProbeResult>=>{
    try {
      if(!obj(scope)||Reflect.ownKeys(scope).length!==3||
        !Object.hasOwn(scope,"principalId")||!Object.hasOwn(scope,"tenantId")||
        !Object.hasOwn(scope,"product")||!UUID.test(scope.principalId)||
        !UUID.test(scope.tenantId)||scope.product!=="demand")deny();
      // Pin all authorization parameters BEFORE the first await. No request
      // objects, untrusted query args, getters or mutable references survive.
      const principalId=scope.principalId.toLowerCase(),tenantId=scope.tenantId.toLowerCase();
      const alternate=tenantId===ALT_TENANT?ALT_TENANT_2:ALT_TENANT;
      return await transaction(async query=>{
        const role=await query(
          `SELECT current_user AS "roleName",session_user AS "sessionRoleName",
            rolcanlogin AS "canLogin",rolinherit AS "inherits",
            rolsuper AS "superuser",rolbypassrls AS "bypassRls",
            rolcreatedb AS "canCreateDb",rolcreaterole AS "canCreateRole",
            rolreplication AS "canReplicate",
            (SELECT count(*)::integer FROM pg_auth_members m WHERE m.member=r.oid) AS "parentRoles"
            FROM pg_roles r WHERE r.rolname=current_user`,[]);
        const identity=role.rows[0];
        if(role.rows.length!==1||!obj(identity)||
          identity.roleName!==EXPECTED_ROLE||identity.sessionRoleName!==EXPECTED_ROLE||
          identity.canLogin!==true||identity.inherits!==false||
          identity.superuser!==false||identity.bypassRls!==false||
          identity.canCreateDb!==false||identity.canCreateRole!==false||
          identity.canReplicate!==false||identity.parentRoles!==0)deny();

        const posture=await query(
          `SELECT current_database() AS "databaseName",
             (SELECT COUNT(*)::integer FROM pg_class c
                JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='bci_dev' AND c.relname IN ('evidence','tenant_memberships')
                 AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relforcerowsecurity) AS "forcedTables",
             has_table_privilege(current_user,'bci_dev.evidence','SELECT') AS "canSelectEvidence",
             has_table_privilege(current_user,'bci_dev.evidence','INSERT') AS "canInsertEvidence",
             NOT has_table_privilege(current_user,'bci_dev.evidence','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noEvidenceMutation",
             (SELECT bool_and(has_column_privilege(current_user,'bci_dev.tenant_memberships',x.col,'SELECT'))
                FROM (VALUES ('principal_id'),('tenant_id'),('product'),('active'),('revoked_at')) x(col)) AS "canReadMembershipColumns",
             NOT has_table_privilege(current_user,'bci_dev.tenant_memberships','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noMembershipMutation",
             NOT has_schema_privilege(current_user,'bci_dev','CREATE') AS "noSchemaCreate",
             NOT has_database_privilege(current_user,current_database(),'CREATE') AS "noDatabaseCreate",
             NOT has_table_privilege(current_user,'bci_dev.content_dispatch_approvals','SELECT,INSERT,UPDATE,DELETE') AS "noApprovalAccess",
             (SELECT count(*)::integer FROM pg_policies
               WHERE schemaname='bci_dev' AND 'bci_dev_evidence_writer_restricted'=ANY(roles)
                 AND policyname IN ('bci_evidence_writer_demand_insert_v1',
                                    'bci_evidence_writer_demand_select_v1',
                                    'bci_evidence_writer_membership_select_v1')) AS "requiredPolicies"
           `,[]);
        const p=posture.rows[0];
        if(posture.rows.length!==1||!obj(p)||
          p.databaseName!=="bros_intelligence_dev"||p.forcedTables!==2||
          p.canSelectEvidence!==true||p.canInsertEvidence!==true||
          p.noEvidenceMutation!==true||p.canReadMembershipColumns!==true||
          p.noMembershipMutation!==true||p.noSchemaCreate!==true||
          p.noDatabaseCreate!==true||p.noApprovalAccess!==true||
          p.requiredPolicies!==3)deny();

        await assertRestrictedEvidenceWriterPolicies(query);
        await query("SELECT set_config('bci.principal_id',$1,true),set_config('bci.tenant_id',$2,true),set_config('bci.product',$3,true)",
          [principalId,tenantId,"demand"]);
        const member=async(expectedCount:number)=>{
          const out=await query(`SELECT COUNT(*)::integer AS "count"
            FROM bci_dev.tenant_memberships
            WHERE principal_id=$1::uuid AND tenant_id=$2::uuid
              AND product='demand' AND active IS TRUE AND revoked_at IS NULL`,
            [principalId,tenantId]);
          if(out.rows.length!==1||!obj(out.rows[0])||out.rows[0].count!==expectedCount)deny();
        };
        await member(1);
        const foreign=await query(`SELECT COUNT(*)::integer AS "count"
          FROM bci_dev.evidence WHERE tenant_id<>$1::uuid
            OR product<>'demand' OR provider<>'meta_ads'`,[tenantId]);
        if(foreign.rows.length!==1||!obj(foreign.rows[0])||
          foreign.rows[0].count!==0)deny();

        // Changing tenant scope should revoke the authenticated membership view
        // even though the JWT / PG session is unchanged. Restore before leaving.
        await query("SELECT set_config('bci.tenant_id',$1,true)",[alternate]);
        await member(0);
        await query("SELECT set_config('bci.tenant_id',$1,true)",[tenantId]);
        await member(1);
        return Object.freeze({
          directRestrictedLoginVerified:true as const,
          forcedRlsAndPrivilegesVerified:true as const,
          activeDemandMembershipVerified:true as const,
          readOnlyScopeSmokeVerified:true as const,
          evidenceAppended:false as const,
          authenticatedProviderReceiptRecorded:false as const,
        });
      });
    } catch {return deny();}
  };
}
