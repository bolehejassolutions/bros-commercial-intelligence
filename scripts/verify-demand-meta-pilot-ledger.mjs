import { Pool } from "pg";
import { isVerifiedDemandMetaManagementPreflight } from "./demand-meta-preflight-gate.mjs";
import { parseNeonDevConnection } from "../lib/bci/neon-readonly-transaction.ts";
import { verifyPilotLedger, PilotLedgerVerificationFailed } from "../lib/demand/meta-pilot-ledger-verification.ts";
import { inspectExistingDemandMetaToken } from "../lib/demand/meta-token-capability.ts";
import { pilotMetaConfiguration } from "../lib/demand/meta-pilot-environment.ts";
import { inspectMetaConnection } from "../lib/marketing-operator/meta-connection.ts";

const exactPreview = process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === "feat/demand-direct-meta-readonly-20261031";
const verification = process.env.BROS_DEMAND_META_PILOT_LEDGER_VERIFICATION;
if (!exactPreview || !verification || verification === "completed-v1") {
  console.log("BROS_DEMAND_PILOT_LEDGER_CHECK", "SKIPPED_OUTSIDE_APPROVED_PREVIEW");
} else {
  let pool;
  try {
    const proof = JSON.parse(verification);
    if (process.env.BROS_DEMAND_META_PILOT_LEDGER !== "reviewed-v1" ||
        proof?.mode !== "rollback-install-v1" || typeof proof.principalId !== "string") throw Error();
    const config = parseNeonDevConnection(process.env.BCI_NEON_DEV_EVIDENCE_WRITER_DATABASE_URL,
      "bci_dev_evidence_writer_restricted");
    pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000, query_timeout: 7000,
      idleTimeoutMillis: 10000, allowExitOnIdle: true, application_name: "demand-pilot-approved-ledger-proof" });
    pool.on("error", () => { /* Never emit credential-bearing driver errors. */ });
    const receipt = await verifyPilotLedger(pool, {
      tenantId: process.env.BROS_DEMAND_META_TENANT_ID ?? "",
      principalId: proof.principalId,
    });
    console.log("BROS_DEMAND_PILOT_LEDGER_CHECK", JSON.stringify(receipt));
  } catch (e) {
    console.error("BROS_DEMAND_PILOT_LEDGER_CHECK", "FAILED",
      e instanceof PilotLedgerVerificationFailed ? e.phase : "configuration");
    process.exitCode = 1;
  } finally { if (pool) await pool.end().catch(() => {}); }
}

// Explicit owner-authorized GET-only scope audit. This does not unlock writes.
if (exactPreview && process.env.BROS_DEMAND_META_TOKEN_AUDIT === "approved-v1") {
  try {
    const audit = await inspectExistingDemandMetaToken(process.env.BROS_DEMAND_META_ADS_READ_TOKEN);
    console.log("BROS_DEMAND_EXISTING_META_TOKEN_AUDIT", JSON.stringify(audit));
    // Explicitly requested read-only audits must not report a green Preview
    // when the configured credential is absent or provider introspection fails.
    if (audit.status !== "CAPABILITY_READBACK" || !audit.fixedAccountReadVerified) {
      console.error("BROS_DEMAND_EXISTING_META_TOKEN_AUDIT", "READBACK_NOT_VERIFIED");
      process.exitCode = 1;
    }
  } catch {
    console.error("BROS_DEMAND_EXISTING_META_TOKEN_AUDIT", "PROVIDER_UNAVAILABLE");
    process.exitCode = 1;
  }
}

// Audit the separately owner-saved management credential without decrypting it
// outside the existing server or unlocking any Meta write/staging/launch path.
if (exactPreview && process.env.BROS_DEMAND_META_MANAGEMENT_TOKEN_AUDIT === "approved-v1") {
  const { environment, managementCredentialConflict, configurationChecks } = pilotMetaConfiguration(process.env);
  console.log("BROS_DEMAND_MANAGEMENT_META_CONFIGURATION", JSON.stringify(configurationChecks));
  if (managementCredentialConflict || !configurationChecks.managementTokenFormatAccepted ||
      !configurationChecks.appSecretFormatAccepted || !configurationChecks.appIdConfigured) {
    // An explicitly approved Preview audit must not succeed when the management
    // credential is missing, conflicting or malformed. Never log secret values.
    console.error("BROS_DEMAND_MANAGEMENT_META_PREFLIGHT", "CONFIGURATION_REJECTED");
    process.exitCode = 1;
  } else {
    try {
      const audit = await inspectExistingDemandMetaToken(environment.META_ADS_MANAGEMENT_TOKEN);
      console.log("BROS_DEMAND_MANAGEMENT_META_TOKEN_AUDIT", JSON.stringify(audit));
      const preflight = await inspectMetaConnection("write", environment);
      console.log("BROS_DEMAND_MANAGEMENT_META_PREFLIGHT", JSON.stringify(preflight));
      // A diagnostic GET is not an authorization to stage or activate ads.
      // Reject missing or explicitly unsuccessful provider results.
      if (!isVerifiedDemandMetaManagementPreflight(preflight)) {
        console.error("BROS_DEMAND_MANAGEMENT_META_PREFLIGHT", "PROVIDER_REJECTED");
        process.exitCode = 1;
      }
    } catch {
      console.error("BROS_DEMAND_MANAGEMENT_META_PREFLIGHT", "PROVIDER_UNAVAILABLE");
      process.exitCode = 1;
    }
  }
}
