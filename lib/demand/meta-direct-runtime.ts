import "server-only";
import { Pool } from "pg";
import { createNeonAuthPrincipalVerifier } from "../bci/neon-auth-principal.ts";
import { createNeonDevMembershipLookup } from "../bci/neon-dev-membership-rows.ts";
import { createPgReadOnlyTransaction, parseNeonDevConnection } from "../bci/neon-readonly-transaction.ts";
import { createDemandMetaHttpHandler } from "./meta-direct-http.ts";

/**
 * Existing BCI app, DEVELOPMENT Preview branch ONLY. Default OFF.
 * This does not create a public SaaS, Meta app, grant, paid integration,
 * campaign writer, scheduler or production capability.
 *
 * Credential authority is exclusively this server deployment's secrets.
 * The Meta account and tenant are PINNED to one approved internal pilot.
 */
const authBase = "https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const BRANCH = "feat/demand-direct-meta-readonly-20261031";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const account = /^act_[0-9]+$/;
const digits = /^[0-9]+$/;
const version = /^v[1-9][0-9]?\.[0-9]+$/;
const enabled = () =>
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === BRANCH &&
  process.env.BROS_DEMAND_META_DIRECT_READS === "enabled" &&
  typeof process.env.BROS_DEMAND_META_ACCOUNT_ID === "string" &&
  account.test(process.env.BROS_DEMAND_META_ACCOUNT_ID) &&
  typeof process.env.BROS_DEMAND_META_CAMPAIGN_ID === "string" &&
  digits.test(process.env.BROS_DEMAND_META_CAMPAIGN_ID) &&
  typeof process.env.BROS_DEMAND_META_API_VERSION === "string" &&
  version.test(process.env.BROS_DEMAND_META_API_VERSION) &&
  typeof process.env.BROS_DEMAND_META_TENANT_ID === "string" &&
  uuid.test(process.env.BROS_DEMAND_META_TENANT_ID) &&
  typeof process.env.BROS_DEMAND_META_ADS_READ_TOKEN === "string" &&
  process.env.BROS_DEMAND_META_ADS_READ_TOKEN.length >= 20 &&
  Boolean(process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL);

let memberships: ReturnType<typeof createNeonDevMembershipLookup> | null = null;
function getMemberships() {
  if (!enabled()) throw new Error("DEMAND_META_PREVIEW_DISABLED");
  if (!memberships) {
    const config = parseNeonDevConnection(
      process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL,
      "bci_dev_membership_reader",
    );
    // Existing separate restricted membership-only database role.
    const pool = new Pool({ ...config, max: 2, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, allowExitOnIdle: true,
      application_name: "demand-meta-private-preview", query_timeout: 7000 });
    pool.on("error", () => { /* Never log password-bearing driver errors. */ });
    memberships = createNeonDevMembershipLookup(createPgReadOnlyTransaction(pool));
  }
  return memberships;
}
const verifier = createNeonAuthPrincipalVerifier({
  issuer: new URL(authBase).origin,
  audience: new URL(authBase).origin,
  jwksUrl: authBase + "/.well-known/jwks.json",
  approvedOperator: { email: "rasymokh@gmail.com" },
});
const handler = createDemandMetaHttpHandler({
  enabled,
  // These server-bound IDs are NOT chosen from request URL or headers.
  accountId: process.env.BROS_DEMAND_META_ACCOUNT_ID ?? "act_0",
  campaignId: process.env.BROS_DEMAND_META_CAMPAIGN_ID ?? "0",
  apiVersion: process.env.BROS_DEMAND_META_API_VERSION ?? "v26.0",
  verifyJwt: token => verifier(token),
  membershipsFor: (userId, product) => getMemberships()(userId, product),
  serverTokenFor: async (tenantId, accountId) => {
    if (!enabled() ||
        tenantId !== process.env.BROS_DEMAND_META_TENANT_ID?.toLowerCase() ||
        accountId !== process.env.BROS_DEMAND_META_ACCOUNT_ID) return null;
    // The business-owned token needs ads_read and valid Meta account access.
    // Never reuse connected ChatGPT/HYPD/Supermetrics credentials.
    return process.env.BROS_DEMAND_META_ADS_READ_TOKEN ?? null;
  },
  now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
});

export const handleDemandMetaPrivatePreview = (request: Request) => handler(request);
