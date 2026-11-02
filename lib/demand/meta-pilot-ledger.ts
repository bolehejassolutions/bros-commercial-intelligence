import { PILOT, type Snapshot, type Step, type StepResult } from "./meta-pilot-policy.ts";

type Row = Record<string, unknown>;
type Query = (sql: string, params: readonly (string | null)[]) => Promise<{ rows: readonly unknown[] }>;
export type PilotTransaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
export type PilotScope = Readonly<{ tenantId: string; principalId: string }>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export class PilotReconciliationRequired extends Error {
  constructor() { super("META_WRITE_MAY_HAVE_COMMITTED_RECONCILE_REQUIRED"); }
}
const row = (v: unknown): Row => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("PILOT_LEDGER_INVALID");
  return v as Row;
};
function result(v: unknown): StepResult {
  const r = row(v);
  if (Object.keys(r).some(k => !["id", "hash", "start", "end", "status"].includes(k)) ||
      (r.id !== undefined && (typeof r.id !== "string" || !/^\d{6,30}$/.test(r.id))) ||
      (r.hash !== undefined && (typeof r.hash !== "string" || !/^[a-f0-9]{32}$/i.test(r.hash))) ||
      ["start", "end"].some(k => r[k] !== undefined && (typeof r[k] !== "string" || !Number.isFinite(Date.parse(r[k] as string)))) ||
      (r.status !== undefined && r.status !== "ACTIVE") || !Object.keys(r).length)
    throw Error("PILOT_LEDGER_RESULT_INVALID");
  return r as StepResult;
}

/** Uses the existing restricted LOGIN and existing Neon DEV backend. No role creation. */
export function createPilotLedger(transaction: PilotTransaction, scope: PilotScope) {
  if (!UUID.test(scope.tenantId) || !UUID.test(scope.principalId)) throw Error("PILOT_SCOPE_DENIED");
  const scoped = async <T>(fn: (query: Query) => Promise<T>, lock = true) => transaction(async query => {
    const identity = await query(`SELECT current_user AS role_name, session_user AS session_role,
      current_database() AS database_name, rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb,
      (SELECT count(*)::integer FROM pg_auth_members WHERE member=pg_roles.oid) AS parents
      FROM pg_roles WHERE rolname=current_user`, []);
    const r = row(identity.rows[0]);
    if (identity.rows.length !== 1 || r.role_name !== "bci_dev_evidence_writer_restricted" ||
        r.session_role !== r.role_name || r.database_name !== "bros_intelligence_dev" || r.rolsuper !== false ||
        r.rolbypassrls !== false || r.rolcanlogin !== true || r.rolcreaterole !== false || r.rolcreatedb !== false || r.parents !== 0)
      throw Error("RESTRICTED_PILOT_LOGIN_REQUIRED");
    const posture = await query(`SELECT relrowsecurity AND relforcerowsecurity AS forced_rls,
      has_table_privilege(current_user,oid,'SELECT') AS can_read,
      has_table_privilege(current_user,oid,'INSERT') AS can_append,
      has_table_privilege(current_user,oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS can_mutate,
      relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owns_table
      FROM pg_class WHERE oid=to_regclass('bci_dev.demand_meta_pilot_events')`, []);
    const p = row(posture.rows[0]);
    if (posture.rows.length !== 1 || p.forced_rls !== true || p.can_read !== true ||
        p.can_append !== true || p.can_mutate !== false || p.owns_table !== false)
      throw Error("PILOT_LEDGER_NOT_PROVISIONED");
    await query("SELECT set_config('bci.tenant_id',$1,true),set_config('bci.product','demand',true),set_config('bci.principal_id',$2,true)",
      [scope.tenantId, scope.principalId]);
    // Serialize writes and stop requests for this existing campaign. An intent
    // is still committed separately so a killed process cannot silently retry.
    if (lock) await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [scope.tenantId + ":" + PILOT.campaign]);
    const grants = await query(`SELECT principal_id FROM bci_dev.tenant_memberships WHERE
      principal_id=$1::uuid AND tenant_id=$2::uuid AND product='demand' AND active=true AND revoked_at IS NULL`,
      [scope.principalId, scope.tenantId]);
    if (grants.rows.length !== 1) throw Error("PILOT_MEMBERSHIP_DENIED");
    const answer = await fn(query);
    const after = await query(`SELECT principal_id FROM bci_dev.tenant_memberships WHERE
      principal_id=$1::uuid AND tenant_id=$2::uuid AND product='demand' AND active=true AND revoked_at IS NULL`,
      [scope.principalId, scope.tenantId]);
    if (after.rows.length !== 1) throw Error("PILOT_MEMBERSHIP_REVOKED");
    return answer;
  });
  const readEvents = (query: Query) => query(`SELECT step, kind, result FROM bci_dev.demand_meta_pilot_events
    WHERE tenant_id=$1::uuid AND product='demand' AND policy_key=$2 ORDER BY created_at, id`, [scope.tenantId, PILOT.key]);
  return {
    async snapshot(): Promise<Snapshot> {
      return scoped(async query => {
        const events = await readEvents(query); const snapshot: Snapshot = {};
        const intents = new Set<string>(); const confirmed = new Set<string>();
        for (const value of events.rows) {
          const e = row(value), step = String(e.step) as Step;
          if (e.kind === "revoked") throw Error("PILOT_STOP_REVIEW_REQUIRED");
          if (e.kind === "intent") intents.add(step);
          else if (e.kind === "confirmed") { snapshot[step] = result(e.result); confirmed.add(step); }
          else throw Error("PILOT_LEDGER_INVALID");
        }
        if ([...intents].some(step => !confirmed.has(step))) throw new PilotReconciliationRequired();
        return snapshot;
      });
    },
    async perform(step: Step, externalWrite: () => Promise<StepResult>): Promise<StepResult> {
      const claim = await scoped(async query => {
        const stopped = await query(`SELECT id FROM bci_dev.demand_meta_pilot_events
          WHERE tenant_id=$1::uuid AND product='demand' AND policy_key=$2 AND kind='revoked'`, [scope.tenantId, PILOT.key]);
        if (stopped.rows.length) throw Error("PILOT_STOP_REVIEW_REQUIRED");
        const previous = await query(`SELECT kind,result FROM bci_dev.demand_meta_pilot_events
          WHERE tenant_id=$1::uuid AND product='demand' AND policy_key=$2 AND step=$3`, [scope.tenantId, PILOT.key, step]);
        const confirmation = previous.rows.map(row).find(e => e.kind === "confirmed");
        if (confirmation) return { replay: result(confirmation.result) };
        if (previous.rows.length) throw new PilotReconciliationRequired();
        const inserted = await query(`INSERT INTO bci_dev.demand_meta_pilot_events
          (tenant_id,product,principal_id,policy_key,step,kind,result)
          VALUES($1::uuid,'demand',$2::uuid,$3,$4,'intent','{}'::jsonb)
          ON CONFLICT(tenant_id,product,policy_key,step,kind) DO NOTHING RETURNING id`,
          [scope.tenantId, scope.principalId, PILOT.key, step]);
        if (inserted.rows.length !== 1) throw new PilotReconciliationRequired();
        return { replay: null };
      });
      if (claim.replay) return claim.replay;
      // Intent has COMMITTED before the provider POST. Any later uncertainty
      // permanently blocks automatic replay until an independent reconciliation.
      try {
        return await scoped(async query => {
          const stopped = await query(`SELECT id FROM bci_dev.demand_meta_pilot_events
            WHERE tenant_id=$1::uuid AND product='demand' AND policy_key=$2 AND kind='revoked'`, [scope.tenantId, PILOT.key]);
          if (stopped.rows.length) throw Error("PILOT_STOP_REVIEW_REQUIRED");
          const confirmed = result(await externalWrite());
          const stoppedAfter = await query(`SELECT id FROM bci_dev.demand_meta_pilot_events
            WHERE tenant_id=$1::uuid AND product='demand' AND policy_key=$2 AND kind='revoked'`, [scope.tenantId, PILOT.key]);
          if (stoppedAfter.rows.length) throw Error("PILOT_STOP_REVIEW_REQUIRED");
          const inserted = await query(`INSERT INTO bci_dev.demand_meta_pilot_events
            (tenant_id,product,principal_id,policy_key,step,kind,result)
            VALUES($1::uuid,'demand',$2::uuid,$3,$4,'confirmed',$5::jsonb)
            RETURNING id`, [scope.tenantId, scope.principalId, PILOT.key, step, JSON.stringify(confirmed)]);
          if (inserted.rows.length !== 1) throw Error();
          return confirmed;
        });
      } catch { throw new PilotReconciliationRequired(); }
    },
    async revoke() {
      await scoped(async query => {
        await query(`INSERT INTO bci_dev.demand_meta_pilot_events
          (tenant_id,product,principal_id,policy_key,step,kind,result)
          VALUES($1::uuid,'demand',$2::uuid,$3,'stop','revoked','{}'::jsonb)
          ON CONFLICT(tenant_id,product,policy_key,step,kind) DO NOTHING`,
          [scope.tenantId, scope.principalId, PILOT.key]);
      }, false);
    },
  };
}
