import "server-only";
/**
 * BCI DEV-only, fixed persisted Meta receipt -> UNVERIFIED evidence-stage lineage.
 * Reuses the existing shared Neon membership, private evidence reader and lineage writer.
 * This is not provider attestation or a diagnosis/action/outcome/learning workflow.
 * Broad BCI_NEON_DEV_PRIVATE_WRITES remains disabled.
 */
import { Pool } from "pg";
import { createNeonAuthPrincipalVerifier } from "./neon-auth-principal.ts";
import { createNeonDevMembershipLookup } from "./neon-dev-membership-rows.ts";
import { createNeonDevReadRows } from "./neon-dev-read-rows.ts";
import { BciLineageWriteDenied, createAuthenticatedBciLineageWriter, createPgLineageWriteTransaction,
  createPgLineageReadTransaction } from "./neon-lineage-writer.ts";
import { createAuthenticatedDemandMetaSignal } from "./neon-demand-signal.ts";
import { createDemandMetaReceiptReader } from "../demand/meta-persisted-diagnosis.ts";
import { isNeonPreviewEnabled } from "./neon-preview-handler.ts";
import { createPgReadOnlyTransaction, parseNeonDevConnection } from "./neon-readonly-transaction.ts";

const receipt = "4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const recordKey = "demand:meta-read:sha256:a31d0438050fc4745e4a8c8b8fd36a1ab2345937e7fa55bfa68076f08c1b5a16";
const collectedAt = "2026-11-01T07:22:59.000Z";
const authBase = "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const verify = createNeonAuthPrincipalVerifier({
  issuer: new URL(authBase).origin, audience: new URL(authBase).origin,
  jwksUrl: authBase + "/.well-known/jwks.json",
  approvedOperator: { email: "rasymokh@gmail.com" },
});
const denied = (): never => { throw new BciLineageWriteDenied(); };
type Role = "bci_dev_membership_reader" | "bci_dev_private_reader" | "bci_dev_lineage_writer" |
  "bci_dev_evidence_writer_restricted";
function poolFor(value: unknown, role: Role) {
  const config = parseNeonDevConnection(value, role);
  const pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000, allowExitOnIdle: true, query_timeout: 7000,
    application_name: "bci-dev-fixed-receipt-lineage" });
  pool.on("error", () => { /* Never log driver errors or credentials. */ });
  return pool;
}
function createDeps() {
  const writerPool = poolFor(process.env.BCI_NEON_DEV_LINEAGE_WRITER_DATABASE_URL, "bci_dev_lineage_writer");
  return {
    membershipsFor: createNeonDevMembershipLookup(createPgReadOnlyTransaction(
      poolFor(process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL, "bci_dev_membership_reader"))),
    readRows: createNeonDevReadRows(createPgReadOnlyTransaction(
      poolFor(process.env.BCI_NEON_DEV_EVIDENCE_DATABASE_URL, "bci_dev_private_reader"))),
    transaction: createPgLineageWriteTransaction(writerPool),
    readbackTransaction: createPgLineageReadTransaction(writerPool),
  };
}

let signalReader: ReturnType<typeof createDemandMetaReceiptReader> | undefined;
/** Independently gated exact operation on the existing protected route. */
export async function appendFixedDemandMetaSignal(token: string) {
  if (!isNeonPreviewEnabled(process.env) ||
      process.env.BCI_NEON_DEV_DEMAND_SIGNAL_WRITES !== "enabled") denied();
  try {
    // Never parse credentials or create pools before real JWT verification.
    await verify(token);
    const d = deps ??= createDeps();
    signalReader ??= createDemandMetaReceiptReader(createPgReadOnlyTransaction(poolFor(
      process.env.BCI_NEON_DEV_EVIDENCE_WRITER_DATABASE_URL, "bci_dev_evidence_writer_restricted")));
    return await createAuthenticatedDemandMetaSignal({
      authenticate: () => verify(token), membershipsFor: d.membershipsFor,
      readReceipt: (tenantId, principalId) => signalReader!(tenantId, principalId),
      transaction: d.transaction, readbackTransaction: d.readbackTransaction,
    })();
  } catch { return denied(); }
}
let deps: ReturnType<typeof createDeps> | undefined;
export async function appendFixedDemandMetaReceiptLineage(token: unknown) {
  if (!isNeonPreviewEnabled(process.env) ||
      process.env.BCI_NEON_DEV_LINEAGE_RECEIPT_WRITES !== "enabled") denied();
  try {
    const principal = await verify(token);
    deps ??= createDeps();
    const grants = await deps.membershipsFor(principal.userId, "demand");
    if (grants.length !== 1 || grants[0].principalId !== principal.userId ||
        grants[0].product !== "demand" || grants[0].active !== true) denied();
    const tenantId = grants[0].tenantId;
    const rows = await deps.readRows({ tenantId, product: "demand", limit: 50 });
    const source = rows.filter(row => row.id === receipt && row.provider === "meta_ads" &&
      row.providerRecordKey === recordKey);
    if (source.length !== 1) denied();
    const result = await createAuthenticatedBciLineageWriter({
      authenticate: async () => principal,
      membershipsFor: deps.membershipsFor,
      transaction: deps.transaction,
    })({ product: "demand", records: [{
      id: receipt, tenantId, product: "demand", stage: "evidence",
      sourceSystem: "bci_dev.evidence", sourceRecordKey: receipt,
      recordedAt: collectedAt, parentIds: [], verification: "unverified",
    }] });
    const inserted = result.insertedIds.length === 1 && result.insertedIds[0] === receipt &&
      result.replayedIds.length === 0;
    const replayed = result.replayedIds.length === 1 && result.replayedIds[0] === receipt &&
      result.insertedIds.length === 0;
    if (!inserted && !replayed) denied();
    return Object.freeze({ receiptId: receipt, status: inserted ? "inserted" as const : "replayed" as const,
      stage: "evidence" as const, verification: "unverified" as const,
      providerAttested: false as const });
  } catch { return denied(); }
}

