import "server-only";
import { Pool } from "pg";
import { createNeonDevMembershipLookup } from "./neon-dev-membership-rows.ts";
import { createNeonDevReadRows } from "./neon-dev-read-rows.ts";
import { createNeonPreviewHandler, isNeonPreviewEnabled } from "./neon-preview-handler.ts";
import { createPgReadOnlyTransaction, parseNeonDevConnection, NeonPreviewDatabaseDenied } from "./neon-readonly-transaction.ts";

const authBase = "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
let readers: ReturnType<typeof createReaders> | undefined;

function createReaders() {
  if (!isNeonPreviewEnabled(process.env)) throw new NeonPreviewDatabaseDenied();
  const membershipConfig = parseNeonDevConnection(process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL, "bci_dev_membership_reader");
  const evidenceConfig = parseNeonDevConnection(process.env.BCI_NEON_DEV_EVIDENCE_DATABASE_URL, "bci_dev_private_reader");
  // Separate pools and credentials preserve the independent privilege boundaries.
  const makePool = (config: ReturnType<typeof parseNeonDevConnection>) => {
    const pool = new Pool({ ...config, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
      allowExitOnIdle: true, application_name: "bci-private-neon-preview", query_timeout: 7000 });
    pool.on("error", () => { /* Idle clients are discarded by pg; secret-bearing errors are never logged. */ });
    return pool;
  };
  const membershipPool = makePool(membershipConfig);
  const evidencePool = makePool(evidenceConfig);
  return {
    membershipsFor: createNeonDevMembershipLookup(createPgReadOnlyTransaction(membershipPool)),
    readRows: createNeonDevReadRows(createPgReadOnlyTransaction(evidencePool)),
  };
}

const handle = createNeonPreviewHandler({
  env: () => process.env,
  verifierConfig: {
    issuer: new URL(authBase).origin,
    audience: new URL(authBase).origin,
    jwksUrl: `${authBase}/.well-known/jwks.json`,
  },
  // Credential parsing and pool creation occur only after JWT verification succeeds.
  membershipsFor: async (principalId, product) => {
    readers ??= createReaders();
    return readers.membershipsFor(principalId, product);
  },
  readRows: async scope => {
    readers ??= createReaders();
    return readers.readRows(scope);
  },
});

export const handleNeonPreviewEvidence = (request: Request) => handle(request);
