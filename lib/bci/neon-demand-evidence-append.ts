/**
 * BCI internal-only DEMAND Meta evidence append boundary (NOT a route or live job).
 * It has no credentials, no feature flag, and no public caller input.
 *
 * The trusted server must inject independently checked Neon Auth, current
 * membership, and a server-owned bounded Meta GET. A candidate hash is NEVER
 * independent provider attestation. Persisted rows remain "unverified"; never
 * derive sales, CPA or experiment outcomes from these observations alone.
 *
 * No SQL changes, grants, provider writes or production activation here.
 */
import { planUnattestedDemandMetaEvidenceIntake } from "./demand-meta-intake-preflight.ts";

type Candidate = Parameters<typeof planUnattestedDemandMetaEvidenceIntake>[1];
type Report = Parameters<typeof planUnattestedDemandMetaEvidenceIntake>[2];
type Scope = Parameters<typeof planUnattestedDemandMetaEvidenceIntake>[0];
type Principal = Readonly<{ userId: string; authenticated: true }>;
type Grant = Readonly<{ principalId: string; tenantId: string; product: "demand"; active: true }>;
type SqlValue = string | null;
type Result = Readonly<{ rows: readonly unknown[] }>;
type Query = (sql: string, params: readonly SqlValue[]) => Promise<Result>;
export type EvidenceAppendTransaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
type Client = Readonly<{
  query: (sql: string, params?: readonly SqlValue[]) => Promise<Result>;
  release: (destroy?: boolean) => void;
}>;
type Pool = Readonly<{ connect: () => Promise<Client> }>;
type FixedCampaign = Readonly<{ accountId: string; campaignId: string; since: string; until: string }>;
type Deps = Readonly<{
  fixedCampaign: FixedCampaign;
  authenticate: () => Promise<Principal | null>;
  membershipsFor: (principalId: string) => Promise<readonly Grant[]>;
  observeServerMeta: (scope: Scope) => Promise<Readonly<{ candidate: Candidate; report: Report }>>;
  transaction: EvidenceAppendTransaction;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: unknown, keys: readonly string[]): boolean =>
  object(v) && Reflect.ownKeys(v).length === keys.length &&
  Reflect.ownKeys(v).every(k => typeof k === "string" && keys.includes(k) &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(v,k), "value"));
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k,x[k]])) : x);
export class BciDemandEvidenceAppendDenied extends Error {
  constructor() { super("BCI DEMAND evidence append denied."); this.name="BciDemandEvidenceAppendDenied"; }
}
const deny = (): never => { throw new BciDemandEvidenceAppendDenied(); };
const isDay = (x: unknown): x is string =>
  typeof x === "string" && DAY.test(x) &&
  Number.isFinite(Date.parse(x+"T00:00:00Z")) &&
  new Date(Date.parse(x+"T00:00:00Z")).toISOString().slice(0,10)===x;
const readGrant = (g: readonly Grant[], userId: string): string => {
  if (!Array.isArray(g) || g.length !== 1 ||
      !exact(g[0],["principalId","tenantId","product","active"]) ||
      g[0].principalId!==userId || g[0].product!=="demand" ||
      g[0].active!==true || !UUID.test(g[0].tenantId)) deny();
  return g[0].tenantId.toLowerCase();
};
const dateValue = (x: unknown): number => {
  const d = x instanceof Date ? x.getTime() : typeof x==="string" ? Date.parse(x) : Number.NaN;
  if (!Number.isFinite(d)) deny();
  return d;
};

/** Direct physical LOGIN, serializable, bounded and rollback-on-denial only. */
export function createPgDemandEvidenceAppendTransaction(pool: Pool): EvidenceAppendTransaction {
  if (!pool || typeof pool.connect!=="function") deny();
  return async <T>(fn: (query: Query) => Promise<T>): Promise<T> => {
    let client: Client | undefined;
    let active=false, destroy=false;
    try {
      client=await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE");
      await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
      active=true;
      const pinned=client;
      const result=await fn((sql,params) => {
        if(!active) deny();
        return pinned.query(sql,[...params]);
      });
      active=false;
      await client.query("COMMIT");
      return result;
    } catch {
      active=false; destroy=true;
      if(client) { try { await client.query("ROLLBACK"); } catch { /* destroy */ } }
      return deny();
    } finally { active=false; client?.release(destroy); }
  };
}

/**
 * Deliberately no request argument; scope and Meta reader are injected by
 * server-owned code only. No caller-provided receipt or permission-to-write.
 * The DB writer role and matching RLS policy are NOT yet provisioned.
 */
export function createBciDemandMetaEvidenceAppender(deps: Deps) {
  if (!deps || typeof deps.authenticate!=="function" ||
      typeof deps.membershipsFor!=="function" ||
      typeof deps.observeServerMeta!=="function" ||
      typeof deps.transaction!=="function" ||
      !exact(deps.fixedCampaign,["accountId","campaignId","since","until"])) deny();
  const c=deps.fixedCampaign;
  const fixed=Object.freeze({accountId:c.accountId,campaignId:c.campaignId,since:c.since,until:c.until});
  if (typeof fixed.accountId!=="string" || !/^act_\d+$/.test(fixed.accountId) ||
      typeof fixed.campaignId!=="string" || !/^\d+$/.test(fixed.campaignId) ||
      !isDay(fixed.since) || !isDay(fixed.until) || fixed.since>fixed.until) deny();

  return async (): Promise<Readonly<{ status: "inserted" | "replayed"; recordId: string;
      independentlyAttestedProvider: false; verifiedPaidOrders: null }>> => {
    try {
      const principal=await deps.authenticate();
      if (!exact(principal,["userId","authenticated"]) ||
          principal!.authenticated!==true || !UUID.test(principal!.userId)) deny();
      const userId=principal!.userId.toLowerCase();
      const tenantId=readGrant(await deps.membershipsFor(userId),userId);
      const scope: Scope=Object.freeze({tenantId,product:"demand" as const,...fixed});
      // This callback MUST be a server-owned direct Meta GET, never HTTP user input.
      const observation=await deps.observeServerMeta(scope);
      if (!exact(observation,["candidate","report"])) deny();
      const plan=planUnattestedDemandMetaEvidenceIntake(scope,observation.candidate,observation.report);
      if(plan.permissionToWrite!==false || plan.authenticatedProviderReceiptRecorded!==false ||
         plan.proposedRow.completeness!=="unverified") deny();
      if(readGrant(await deps.membershipsFor(userId),userId)!==tenantId) deny();

      // Snapshot the preflight before another async operation can mutate input.
      const source=plan.proposedRow;
      const metrics=JSON.stringify(source.metrics);
      const facts=JSON.stringify(source.facts);
      // The row is about to be persisted, so remove the preflight-only unknown.
      const unknowns=JSON.stringify(source.unknowns.filter(x=>x!=="bci_durable_receipt_not_recorded"));
      const expected=Object.freeze({
        tenant_id:tenantId, product:"demand", provider:"meta_ads",
        provider_record_key:source.provider_record_key,
        source_reference:source.source_reference,
        observed_at:source.observed_at, period_start:source.period_start,
        period_end:source.period_end, collected_at:source.collected_at,
        completeness:"unverified", metrics:JSON.parse(metrics),
        facts:JSON.parse(facts), unknowns:JSON.parse(unknowns),
      });
      return await deps.transaction(async query => {
        const identity=await query(
          `SELECT current_user AS "roleName", session_user AS "sessionRoleName",
             rolcanlogin AS "canLogin", rolsuper AS "superuser",
             rolbypassrls AS "bypassRls", rolcreatedb AS "canCreateDb",
             rolcreaterole AS "canCreateRole", rolreplication AS "canReplicate",
             rolinherit AS "inherits",
             (SELECT count(*)::integer FROM pg_auth_members m WHERE m.member=pg_roles.oid) AS "parentRoles"
             FROM pg_roles WHERE rolname=current_user`,[]);
        const r=identity.rows[0];
        if(identity.rows.length!==1 || !object(r) ||
           r.roleName!=="bci_dev_evidence_writer" || r.sessionRoleName!=="bci_dev_evidence_writer" ||
           r.canLogin!==true || r.superuser!==false || r.bypassRls!==false ||
           r.canCreateDb!==false || r.canCreateRole!==false || r.canReplicate!==false ||
           r.inherits!==false || r.parentRoles!==0) deny();
        const posture=await query(
          `SELECT current_database() AS "databaseName",
             bool_and(relrowsecurity AND relforcerowsecurity) AS "forcedRls",
             has_table_privilege(current_user,'bci_dev.evidence','INSERT') AS "canInsert",
             has_table_privilege(current_user,'bci_dev.evidence','SELECT') AS "canSelect",
             NOT has_table_privilege(current_user,'bci_dev.evidence','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noEvidenceMutation",
             has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS "canReadMembership",
             NOT has_table_privilege(current_user,'bci_dev.tenant_memberships','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS "noMembershipMutation",
             NOT has_schema_privilege(current_user,'bci_dev','CREATE') AS "noSchemaCreate",
             NOT has_database_privilege(current_user,current_database(),'CREATE') AS "noDbCreate",
             NOT has_table_privilege(current_user,'bci_dev.content_dispatch_approvals','SELECT,INSERT,UPDATE,DELETE') AS "noApprovalAccess"
             FROM pg_class WHERE oid IN ('bci_dev.evidence'::regclass,'bci_dev.tenant_memberships'::regclass)`,[]);
        const p=posture.rows[0];
        if(posture.rows.length!==1 || !object(p) ||
           p.databaseName!=="bros_intelligence_dev" || p.forcedRls!==true ||
           p.canInsert!==true || p.canSelect!==true ||
           p.noEvidenceMutation!==true || p.canReadMembership!==true ||
           p.noMembershipMutation!==true || p.noSchemaCreate!==true ||
           p.noDbCreate!==true || p.noApprovalAccess!==true) deny();

        // GUCs only filter RLS; they are NOT authentication. Restricted direct
        // LOGIN + verified identity + fresh membership are mandatory above.
        await query("SELECT set_config('bci.tenant_id',$1,true),set_config('bci.product',$2,true)",[tenantId,"demand"]);
        const recheck=async () => {
          const m=await query(
            `SELECT principal_id AS "principalId" FROM bci_dev.tenant_memberships
              WHERE principal_id=$1::uuid AND tenant_id=$2::uuid
                AND product='demand' AND active=true AND revoked_at IS NULL`,[userId,tenantId]);
          if(m.rows.length!==1 || !object(m.rows[0]) ||
             m.rows[0].principalId!==userId) deny();
        };
        await recheck();
        const inserted=await query(
          `INSERT INTO bci_dev.evidence
            (tenant_id,product,provider,provider_record_key,source_reference,
             observed_at,period_start,period_end,collected_at,completeness,metrics,facts,unknowns)
           VALUES ($1::uuid,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,
                   $8::timestamptz,$9::timestamptz,$10,$11::jsonb,$12::jsonb,$13::jsonb)
           ON CONFLICT (tenant_id,product,provider,provider_record_key) DO NOTHING
           RETURNING id`,[
            tenantId,"demand","meta_ads",expected.provider_record_key,
            expected.source_reference,expected.observed_at,expected.period_start,
            expected.period_end,expected.collected_at,"unverified",metrics,facts,unknowns,
          ]);
        if(inserted.rows.length>1) deny();
        const fetched=await query(
          `SELECT id,tenant_id,product,provider,provider_record_key,source_reference,
             observed_at,period_start,period_end,collected_at,completeness,metrics,facts,unknowns
           FROM bci_dev.evidence WHERE tenant_id=$1::uuid AND product='demand'
             AND provider='meta_ads' AND provider_record_key=$2`,[tenantId,expected.provider_record_key]);
        const actual=fetched.rows[0];
        if(fetched.rows.length!==1 || !object(actual) || !UUID.test(String(actual.id)) ||
           actual.tenant_id!==tenantId || actual.product!=="demand" ||
           actual.provider!=="meta_ads" || actual.provider_record_key!==expected.provider_record_key ||
           actual.source_reference!==expected.source_reference ||
           actual.completeness!=="unverified" ||
           dateValue(actual.period_start)!==dateValue(expected.period_start) ||
           dateValue(actual.period_end)!==dateValue(expected.period_end) ||
           canon(actual.metrics)!==canon(expected.metrics) ||
           canon(actual.facts)!==canon(expected.facts) ||
           canon(actual.unknowns)!==canon(expected.unknowns)) deny();
        // Time fields may differ across repeated collection of the same logical
        // candidate. Preserve the first append; never UPDATE or DELETE.
        const acceptedRecordId=String(actual.id);
        await recheck();
        return Object.freeze({
          status:inserted.rows.length===1?"inserted" as const:"replayed" as const,
          recordId:acceptedRecordId, independentlyAttestedProvider:false as const,
          verifiedPaidOrders:null,
        });
      });
    } catch { return deny(); }
  };
}
