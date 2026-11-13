import { randomUUID } from "node:crypto";
import { createPilotLedger, type PilotScope } from "./meta-pilot-ledger.ts";
import { createPgPilotTransaction, type PilotPool } from "./meta-pilot-pg.ts";
import { PILOT } from "./meta-pilot-policy.ts";

export type LedgerVerificationPhase = "snapshot" | "connection" | "scope" | "append" |
  "replay" | "tenant_negative" | "product_negative" | "principal_negative" | "rollback" | "readback";
export class PilotLedgerVerificationFailed extends Error {
  readonly phase: LedgerVerificationPhase;
  constructor(phase: LedgerVerificationPhase) { super("PILOT_LEDGER_VERIFICATION_FAILED"); this.phase = phase; }
}
type Row = Record<string, unknown>;
const asRow = (v: unknown): Row => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error();
  return v as Row;
};

/**
 * Real restricted LOGIN/forced-RLS proof using the app's existing secret.
 * The probe row is always ROLLED BACK. No Meta request, durable evidence seed,
 * JWT claim, operator sign-in assertion or launch attestation is manufactured.
 */
export async function verifyPilotLedger(pool: PilotPool, scope: PilotScope,
  options?:Readonly<{pausedCampaignPlanSha256:string}>) {
  let phase: LedgerVerificationPhase = "snapshot";
  const ledger = createPilotLedger(createPgPilotTransaction(pool), scope,options);
  const policyKey=options?"bros-demand-paused-v1:"+options.pausedCampaignPlanSha256:PILOT.key;
  const probeStep=options?"campaign":"image_a";
  try {
    // Includes current_user===session_user, exact role/database, role posture,
    // forced RLS, SELECT/INSERT only, fresh positive membership and advisory lock.
    const initial = await ledger.snapshot();
    if (Object.keys(initial).length !== 0) throw Error("FIRST_INSTALL_EMPTY_LEDGER_REQUIRED");
    phase = "connection";
    const client = await pool.connect();
    let begun = false, destroy = false;
    try {
      await client.query("BEGIN READ WRITE"); begun = true;
      await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
      const setScope = async (tenant: string, product: string, principal: string) => {
        await client.query("SELECT set_config('bci.tenant_id',$1,true),set_config('bci.product',$2,true),set_config('bci.principal_id',$3,true)",
          [tenant, product, principal]);
      };
      phase = "scope";
      await setScope(scope.tenantId, "demand", scope.principalId);
      const probeId = randomUUID();
      const insert = `INSERT INTO bci_dev.demand_meta_pilot_events
        (id,tenant_id,product,principal_id,policy_key,step,kind,result)
        VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,'${probeStep}','intent','{}'::jsonb)
        ON CONFLICT(tenant_id,product,policy_key,step,kind) DO NOTHING RETURNING id`;
      const params = [probeId, scope.tenantId, "demand", scope.principalId, policyKey];
      phase = "append";
      const added = await client.query(insert, params);
      if (added.rows.length !== 1 || asRow(added.rows[0]).id !== probeId) throw Error();
      const visible = await client.query("SELECT id FROM bci_dev.demand_meta_pilot_events WHERE id=$1::uuid", [probeId]);
      if (visible.rows.length !== 1) throw Error();
      phase = "replay";
      const replay = await client.query(insert, params);
      if (replay.rows.length !== 0) throw Error();
      const deny = async (tenant: string, product: string, principal: string) => {
        await setScope(tenant, product, principal);
        const hidden = await client.query("SELECT id FROM bci_dev.demand_meta_pilot_events WHERE id=$1::uuid", [probeId]);
        if (hidden.rows.length !== 0) throw Error();
        await client.query("SAVEPOINT denied_append");
        let rlsDenied = false;
        try { await client.query(insert, [randomUUID(), scope.tenantId, "demand", scope.principalId, policyKey]); }
        catch (e) { rlsDenied = !!e && typeof e === "object" && "code" in e && e.code === "42501"; }
        await client.query("ROLLBACK TO SAVEPOINT denied_append");
        await client.query("RELEASE SAVEPOINT denied_append");
        if (!rlsDenied) throw Error();
      };
      phase = "tenant_negative"; await deny(randomUUID(), "demand", scope.principalId);
      phase = "product_negative"; await deny(scope.tenantId, "content", scope.principalId);
      phase = "principal_negative"; await deny(scope.tenantId, "demand", randomUUID());
      phase = "rollback";
      await client.query("ROLLBACK"); begun = false;
    } catch { destroy = true; throw Error(); }
    finally {
      if (begun) { try { await client.query("ROLLBACK"); } catch { destroy = true; } }
      client.release(destroy);
    }
    phase = "readback";
    const after = await ledger.snapshot();
    if (Object.keys(after).length !== 0) throw Error();
    return Object.freeze({ status: "VERIFIED_PASS", physicalRestrictedLogin: true,
      forcedRlsAndAppendOnlyGrants: true, currentMembership: true, rollbackAppendReadback: true,
      uniqueReplayExclusion: true, wrongTenantDenied: true, wrongProductDenied: true,
      wrongPrincipalDenied: true, probeRolledBack: true, durableProbeRows: 0,
      authenticatedOperatorSessionVerified: false, metaExecutionVerified: false });
  } catch { throw new PilotLedgerVerificationFailed(phase); }
}
