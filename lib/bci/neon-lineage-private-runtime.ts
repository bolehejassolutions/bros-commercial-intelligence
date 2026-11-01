import "server-only";
/**
 * Private BCI shared-core Neon DEV writer runtime. NOT an HTTP route.
 * The only permitted caller is a trusted server-side internal worker.
 * No database URL, password, JWT or principal may be logged or returned.
 * The writer remains disabled until branch-only sensitive credentials and
 * BCI_NEON_DEV_PRIVATE_WRITES=enabled are explicitly configured.
 */
import { Pool } from "pg";
import { createNeonAuthPrincipalVerifier } from "./neon-auth-principal.ts";
import { createAuthenticatedDemandReceiptCaseLink, BciCaseLinkDenied } from "./neon-demand-case-link.ts";
import { createPgDemandEvidenceAppendTransaction } from "./neon-demand-evidence-append.ts";
import { createNeonDevMembershipLookup } from "./neon-dev-membership-rows.ts";
import { createNeonLineageServerBoundary } from "./neon-lineage-server-boundary.ts";
import { BciLineageWriteDenied, createPgLineageWriteTransaction } from "./neon-lineage-writer.ts";
import { isNeonPreviewEnabled } from "./neon-preview-handler.ts";
import { createPgReadOnlyTransaction, parseNeonDevConnection } from "./neon-readonly-transaction.ts";

type AppendRequest = Parameters<ReturnType<typeof createNeonLineageServerBoundary>>[1];
let privateWriter: ReturnType<typeof createNeonLineageServerBoundary> | undefined;

function createPrivateWriter() {
  if (!isNeonPreviewEnabled(process.env) ||
      process.env.BCI_NEON_DEV_PRIVATE_WRITES !== "enabled") {
    throw new BciLineageWriteDenied();
  }
  // Parse BOTH credentials before opening a connection. No fallback to owner/BROS
  // or an existing reader pool is permitted for write transactions.
  const membership = parseNeonDevConnection(
    process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL, "bci_dev_membership_reader");
  const lineage = parseNeonDevConnection(
    process.env.BCI_NEON_DEV_LINEAGE_WRITER_DATABASE_URL, "bci_dev_lineage_writer");
  const makePool = (config: ReturnType<typeof parseNeonDevConnection>) => {
    const pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, allowExitOnIdle: true, query_timeout: 7000,
      application_name: "bci-private-lineage-dev" });
    pool.on("error", () => { /* Never log secret-bearing driver errors. */ });
    return pool;
  };
  const membershipPool = makePool(membership);
  const lineagePool = makePool(lineage);
  return createNeonLineageServerBoundary({
    membershipsFor: createNeonDevMembershipLookup(createPgReadOnlyTransaction(membershipPool)),
    transaction: createPgLineageWriteTransaction(lineagePool),
  });
}

/**
 * Server-only internal entry point. No route imports or invokes this function.
 * The boundary independently rechecks the Preview/write flags, signed JWT,
 * authoritative membership and actual restricted SQL session on every call.
 */
export async function appendNeonDevLineagePrivately(token: unknown, request: AppendRequest) {
  if (!isNeonPreviewEnabled(process.env) ||
      process.env.BCI_NEON_DEV_PRIVATE_WRITES !== "enabled") {
    throw new BciLineageWriteDenied();
  }
  try {
    privateWriter ??= createPrivateWriter();
    return await privateWriter(token, request);
  } catch {
    throw new BciLineageWriteDenied();
  }
}

/**
 * Same EXISTING BCI server runtime, not a new backend or public route.
 * The existing restricted evidence-writer LOGIN is scoped by migration 0021.
 * No browser-controlled tenant, provider, case title, diagnosis or action.
 * Private writes stay OFF until scoped RLS and hosted acceptance are verified.
 */
let caseLinkDeps: ReturnType<typeof createCaseLinkDeps> | undefined;
const caseLinkAuthBase =
  "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const verifyCaseLinkPrincipal = createNeonAuthPrincipalVerifier({
  issuer: new URL(caseLinkAuthBase).origin,
  audience: new URL(caseLinkAuthBase).origin,
  jwksUrl: `${caseLinkAuthBase}/.well-known/jwks.json`,
  approvedOperator: { email: "rasymokh@gmail.com" },
});
function createCaseLinkDeps() {
  const membership = parseNeonDevConnection(
    process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL, "bci_dev_membership_reader");
  const evidence = parseNeonDevConnection(
    process.env.BCI_NEON_DEV_EVIDENCE_WRITER_DATABASE_URL, "bci_dev_evidence_writer_restricted");
  const pool = (config: ReturnType<typeof parseNeonDevConnection>) => {
    const p = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, allowExitOnIdle: true, query_timeout: 7000,
      application_name: "bci-private-demand-case-link-dev" });
    p.on("error", () => { /* No driver errors or credentials in logs. */ });
    return p;
  };
  return {
    membershipsFor: createNeonDevMembershipLookup(createPgReadOnlyTransaction(pool(membership))),
    transaction: createPgDemandEvidenceAppendTransaction(pool(evidence)),
  };
}

/** Server-only explicit receipt admission; never imported into a public route. */
export async function linkPersistedDemandMetaReceiptPrivately(token: unknown, receiptId: unknown) {
  if (!isNeonPreviewEnabled(process.env) ||
      process.env.BCI_NEON_DEV_PRIVATE_WRITES !== "enabled") {
    throw new BciCaseLinkDenied();
  }
  try {
    const principal = await verifyCaseLinkPrincipal(token);
    caseLinkDeps ??= createCaseLinkDeps();
    return await createAuthenticatedDemandReceiptCaseLink({
      authenticate: async () => principal,
      membershipsFor: (id, product) => caseLinkDeps!.membershipsFor(id, product),
      transaction: caseLinkDeps.transaction,
    })(receiptId);
  } catch {
    throw new BciCaseLinkDenied();
  }
}
