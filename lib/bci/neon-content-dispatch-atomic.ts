/**
 * BCI DEV private CONTENT reservation adapter. No HTTP endpoint or provider dispatch.
 * NOT operational until a dedicated directly authenticated least-privilege LOGIN,
 * scoped RLS grants and authenticated provider negatives are verified.
 * Never use BROS/admin credentials or SET ROLE. A reservation is NOT SENT.
 */
type Value = string | null;
type Result = Readonly<{ rows: readonly unknown[] }>;
type Query = (sql: string, params: readonly Value[]) => Promise<Result>;
export type ContentReservationTransaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
export type ContentReservationArgs = Readonly<{
  tenantId: string; product: "content"; principalId: string;
  dispatchIntentId: string; approvalId: string; bindingSha256: string;
}>;
type Reservation = Readonly<{ status: "acquired" | "already_reserved"; reservationId: string | null }>;
/** Recheck is NOT an idempotency lease, provider dispatch authority, or SENT. */
type PreDispatch = Readonly<{ status: "pre_dispatch_rechecked"; reservationId: null;
  providerSent: false; providerAttested: false }>;
type Client = Readonly<{ query: (sql: string, params?: Value[]) => Promise<Result>;
  release: (destroy?: boolean) => void }>;
type Pool = Readonly<{ connect: () => Promise<Client> }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const SHA = /^[a-f0-9]{64}$/;
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
export class BciContentAtomicReservationDenied extends Error {
  constructor() { super("BCI private content reservation denied."); this.name = "BciContentAtomicReservationDenied"; }
}
const deny = (): never => { throw new BciContentAtomicReservationDenied(); };

/** One physical direct LOGIN; SERIALIZABLE rollback and no secret-bearing errors. */
export function createPgContentReservationTransaction(pool: Pool): ContentReservationTransaction {
  if (!pool || typeof pool.connect !== "function") deny();
  return async <T>(fn: (query: Query) => Promise<T>): Promise<T> => {
    let client: Client | undefined; let active = false; let destroy = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE");
      await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
      active = true; const pinned = client;
      const result = await fn((sql, params) => {
        if (!active) deny();
        return pinned.query(sql, [...params]);
      });
      active = false; await client.query("COMMIT");
      return result;
    } catch {
      active = false; destroy = true;
      if (client) { try { await client.query("ROLLBACK"); } catch { /* destroy */ } }
      return deny();
    } finally { active = false; client?.release(destroy); }
  };
}

/**
 * All security predicates and the unique intent INSERT run in one SERIALIZABLE
 * transaction. No FOR UPDATE/SHARE (would require excess UPDATE grants).
 * A revocation committed after reservation MUST be rechecked before dispatch.
 */
export function createPgContentDispatchAtomicReservation(transaction: ContentReservationTransaction):
  (args: ContentReservationArgs) => Promise<Reservation>;
export function createPgContentDispatchAtomicReservation(transaction: ContentReservationTransaction,
  mode: "predispatch_recheck"): (args: ContentReservationArgs) => Promise<PreDispatch>;
export function createPgContentDispatchAtomicReservation(transaction: ContentReservationTransaction,
  mode: "reserve" | "predispatch_recheck" = "reserve") {
  if (typeof transaction !== "function") deny();
  return async (args: ContentReservationArgs): Promise<Reservation | PreDispatch> => {
    try {
      const keys = ["tenantId","product","principalId","dispatchIntentId","approvalId","bindingSha256"];
      if (!obj(args) || Reflect.ownKeys(args).length !== keys.length ||
          !keys.every(k => Object.hasOwn(args,k)) ||
          typeof args.tenantId !== "string" || !UUID.test(args.tenantId) ||
          typeof args.principalId !== "string" || !UUID.test(args.principalId) ||
          args.product !== "content" || typeof args.dispatchIntentId !== "string" ||
          !ID.test(args.dispatchIntentId) || typeof args.approvalId !== "string" ||
          !ID.test(args.approvalId) || typeof args.bindingSha256 !== "string" ||
          !SHA.test(args.bindingSha256)) deny();
      return await transaction(async query => {
        const identity = await query(
          `SELECT current_user AS "roleName", session_user AS "sessionRoleName",
                  rolcanlogin AS "canLogin", rolbypassrls AS "bypassRls",
                  rolsuper AS "superuser", rolcreaterole AS "canCreateRole",
                  rolcreatedb AS "canCreateDb", rolreplication AS "canReplicate",
                  rolinherit AS "inherits",
                  (SELECT count(*)::integer FROM pg_auth_members WHERE member = pg_roles.oid) AS "parentRoles"
           FROM pg_roles WHERE rolname = current_user`, []);
        const role = identity.rows[0];
        if (identity.rows.length !== 1 || !obj(role) ||
            role.roleName !== "bci_dev_content_reserver" ||
            role.sessionRoleName !== "bci_dev_content_reserver" ||
            role.canLogin !== true || role.bypassRls !== false ||
            role.superuser !== false || role.canCreateRole !== false ||
            role.canCreateDb !== false || role.canReplicate !== false ||
            role.inherits !== false || role.parentRoles !== 0) deny();
        const posture = await query(
          `SELECT current_database() AS "databaseName",
                  bool_and(c.relrowsecurity AND c.relforcerowsecurity) AS "forcedRls",
                  NOT has_schema_privilege(current_user,'bci_dev','CREATE') AS "noSchemaCreate",
                  NOT has_database_privilege(current_user,current_database(),'CREATE') AS "noDbCreate",
                  has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS "canReadMembership",
                  (SELECT bool_and(has_column_privilege(current_user,
                    'bci_dev.content_dispatch_approvals', x.col, 'SELECT'))
                   FROM (VALUES ('approval_id'),('tenant_id'),('product'),
                     ('dispatch_intent_id'),('binding_sha256'),
                     ('approved_at'),('expires_at')) AS x(col)) AS "canReadApproval",
                  (SELECT NOT EXISTS (
                    SELECT 1 FROM pg_class t
                    CROSS JOIN LATERAL aclexplode(COALESCE(
                      t.relacl, acldefault('r',t.relowner))) acl
                    WHERE t.oid='bci_dev.content_dispatch_approvals'::regclass
                      AND acl.privilege_type='SELECT'
                      AND acl.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname=current_user))
                  )) AS "noBroadApprovalRead",
                  NOT (
                    has_column_privilege(current_user,'bci_dev.content_dispatch_approvals','signed_review_receipt','SELECT')
                    OR has_column_privilege(current_user,'bci_dev.content_dispatch_approvals','signed_admission_receipt','SELECT')
                    OR has_column_privilege(current_user,'bci_dev.content_dispatch_approvals','signed_admission_nonce','SELECT')
                    OR has_column_privilege(current_user,'bci_dev.content_dispatch_approvals','signed_review_receipt_sha256','SELECT')
                    OR has_column_privilege(current_user,'bci_dev.content_dispatch_approvals','signed_admission_receipt_sha256','SELECT')
                    OR has_column_privilege(current_user,'bci_dev.content_dispatch_approvals','signed_review_evidence_id','SELECT')
                    OR has_column_privilege(current_user,'bci_dev.content_dispatch_approvals','original_media_sha256','SELECT')
                    OR has_column_privilege(current_user,'bci_dev.content_dispatch_approvals','signed_dispatch_intent_sha256','SELECT')
                  ) AS "noApprovalProofRead",
                  has_table_privilege(current_user,'bci_dev.content_dispatch_revocations','SELECT') AS "canReadRevocation",
                  has_table_privilege(current_user,'bci_dev.content_dispatch_reservations','SELECT') AS "canReadReservations",
                  has_table_privilege(current_user,'bci_dev.content_dispatch_reservations','INSERT') AS "canReserve",
                  NOT has_table_privilege(current_user,'bci_dev.tenant_memberships',
                    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noMembershipWrites",
                  NOT has_table_privilege(current_user,'bci_dev.content_dispatch_approvals',
                    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noApprovalWrites",
                  NOT has_table_privilege(current_user,'bci_dev.content_dispatch_revocations',
                    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noRevocationWrites",
                  NOT has_table_privilege(current_user,'bci_dev.content_dispatch_reservations',
                    'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noMutation",
                  -- Views can execute as their owner; treat view grants as out-of-scope too.
                  (SELECT NOT EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
                   WHERE n.nspname='bci_dev' AND t.relkind IN ('r','p','v','m','f')
                     AND t.relname NOT IN ('tenant_memberships','content_dispatch_approvals',
                                          'content_dispatch_revocations','content_dispatch_reservations')
                     AND has_table_privilege(current_user,t.oid,
                       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))) AS "noOtherBci",
                  (SELECT NOT EXISTS (
                    SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
                    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
                      AND n.nspname NOT LIKE 'pg_%'
                      AND f.prosecdef AND has_function_privilege(current_user,f.oid,'EXECUTE')
                  )) AS "noDefinerExec",
                  (SELECT NOT EXISTS (
                    SELECT 1 FROM pg_namespace n
                    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
                      AND n.nspname NOT LIKE 'pg_%'
                      AND has_schema_privilege(current_user,n.oid,'CREATE')
                  )) AS "noOtherSchemaCreate",
                  (SELECT NOT EXISTS (
                    SELECT 1 FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace
                    WHERE s.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema')
                      AND n.nspname NOT LIKE 'pg_%'
                      AND has_sequence_privilege(current_user,s.oid,'USAGE,SELECT,UPDATE')
                  )) AS "noSequenceAccess",
                  (SELECT NOT EXISTS (
                    SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
                    WHERE t.relkind IN ('r','p','v','m','f')
                      AND n.nspname NOT IN ('pg_catalog','information_schema','bci_dev')
                      AND n.nspname NOT LIKE 'pg_%'
                      AND has_table_privilege(current_user,t.oid,
                        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
                  )) AS "noExternalTables"
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='bci_dev' AND c.relname IN
             ('tenant_memberships','content_dispatch_approvals','content_dispatch_revocations','content_dispatch_reservations')
           HAVING count(*)=4`, []);
        const p = posture.rows[0];
        if (posture.rows.length !== 1 || !obj(p) || p.databaseName !== "bros_intelligence_dev" ||
            p.forcedRls !== true || p.noSchemaCreate !== true || p.noDbCreate !== true ||
            p.canReadMembership !== true || p.canReadApproval !== true ||
            p.noBroadApprovalRead !== true || p.noApprovalProofRead !== true ||
            p.canReadRevocation !== true || p.canReadReservations !== true ||
            p.canReserve !== true || p.noMembershipWrites !== true ||
            p.noApprovalWrites !== true || p.noRevocationWrites !== true ||
            p.noMutation !== true || p.noOtherBci !== true ||
            p.noDefinerExec !== true || p.noOtherSchemaCreate !== true ||
            p.noSequenceAccess !== true || p.noExternalTables !== true) deny();
        // Transaction-local GUCs are filters, never proof of identity.
        await query("SELECT set_config('bci.principal_id',$1::text,true), set_config('bci.tenant_id',$2::text,true), set_config('bci.product','content',true)",
          [args.principalId,args.tenantId]);
        const inserted = await query(
          `WITH active_memberships AS MATERIALIZED (
             SELECT principal_id,tenant_id FROM bci_dev.tenant_memberships
             WHERE principal_id=$1::uuid AND tenant_id=$3::uuid AND product='content'
               AND active IS TRUE AND revoked_at IS NULL
           ), eligible_approval AS MATERIALIZED (
             SELECT approval_id,tenant_id,product,dispatch_intent_id,binding_sha256
             FROM bci_dev.content_dispatch_approvals
             WHERE approval_id=$2::text AND tenant_id=$3::uuid AND product='content'
               AND dispatch_intent_id=$4::text AND binding_sha256=$5::text
               AND expires_at > clock_timestamp() AND approved_at <= clock_timestamp()
           ), eligible AS (
             SELECT a.* FROM eligible_approval a
             WHERE (SELECT count(*) FROM active_memberships)=1
               AND EXISTS (SELECT 1 FROM active_memberships m
                           WHERE m.principal_id=$1::uuid AND m.tenant_id=$3::uuid)
               AND NOT EXISTS (SELECT 1 FROM bci_dev.content_dispatch_revocations r
                               WHERE r.approval_id=a.approval_id AND r.tenant_id=a.tenant_id
                                 AND r.product=a.product)
           ), inserted AS (
             INSERT INTO bci_dev.content_dispatch_reservations
               (approval_id,tenant_id,product,dispatch_intent_id,principal_id,binding_sha256)
             SELECT approval_id,tenant_id,product,dispatch_intent_id,$1::uuid,binding_sha256
             FROM eligible ON CONFLICT (tenant_id,product,dispatch_intent_id) DO NOTHING
             RETURNING reservation_id::text AS "reservationId"
           ) SELECT "reservationId" FROM inserted`,
          [args.principalId,args.approvalId,args.tenantId,args.dispatchIntentId,args.bindingSha256]);
        if (inserted.rows.length === 1 && obj(inserted.rows[0]) &&
            typeof inserted.rows[0].reservationId === "string" &&
            UUID.test(inserted.rows[0].reservationId)) {
          // A pre-dispatch check MUST NOT create a new reservation. Throwing
          // inside the transaction rolls back even if the INSERT succeeded.
          if (mode === "predispatch_recheck") deny();
          return Object.freeze({status:"acquired" as const,reservationId:inserted.rows[0].reservationId});
        }
        // A conflicting intent is only disclosed to the SAME still-authorized
        // principal with the SAME live, unrevoked approval and exact binding.
        // Never reveal a prior reservation to a foreign/expired/revoked caller.
        const existing = await query(
          `SELECT count(*)::integer AS "existingCount"
           FROM bci_dev.content_dispatch_reservations r
           JOIN bci_dev.content_dispatch_approvals a
             ON a.approval_id=r.approval_id AND a.tenant_id=r.tenant_id
            AND a.product=r.product AND a.dispatch_intent_id=r.dispatch_intent_id
            AND a.binding_sha256=r.binding_sha256
           WHERE r.tenant_id=$1::uuid AND r.product='content'
             AND r.dispatch_intent_id=$2::text AND r.principal_id=$3::uuid
             AND r.approval_id=$4::text AND r.binding_sha256=$5::text
             AND a.expires_at > clock_timestamp()
             AND a.approved_at <= clock_timestamp()
             AND EXISTS (
               SELECT 1 FROM bci_dev.tenant_memberships m
               WHERE m.principal_id=$3::uuid AND m.tenant_id=$1::uuid
                 AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM bci_dev.content_dispatch_revocations v
               WHERE v.approval_id=a.approval_id AND v.tenant_id=a.tenant_id
                 AND v.product=a.product
             )`,
          [args.tenantId,args.dispatchIntentId,args.principalId,args.approvalId,args.bindingSha256]);
        if (existing.rows.length === 1 && obj(existing.rows[0]) &&
            existing.rows[0].existingCount === 1) {
          // The 0014 BEFORE INSERT trigger rechecks reviewer/requester and
          // approval at the exact conflict attempt, even for DO NOTHING.
          // This does NOT prevent revocation after COMMIT or duplicate provider
          // dispatch. The caller still needs a single-use provider idempotency
          // key, final authorization immediately before the API write, and
          // outcome reconciliation; no route/provider call is enabled here.
          if (mode === "predispatch_recheck") return Object.freeze({
            status:"pre_dispatch_rechecked" as const,reservationId:null,
            providerSent:false as const,providerAttested:false as const });
          return Object.freeze({status:"already_reserved" as const,reservationId:null});
        }
        return deny();
      });
    } catch { return deny(); }
  };
}
