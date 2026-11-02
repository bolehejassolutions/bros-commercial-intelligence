import { Pool } from "pg";
import { parseNeonDevConnection } from "../lib/bci/neon-readonly-transaction.ts";
import { verifyPilotLedger, PilotLedgerVerificationFailed } from "../lib/demand/meta-pilot-ledger-verification.ts";

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
