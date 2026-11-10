import "server-only";
import { createDemandOperatorStatusHandler } from "./meta-operator-http.ts";
import { Pool } from "pg";
import { createNeonAuthPrincipalVerifier, type NeonAuthVerifyStage } from "../bci/neon-auth-principal.ts";
import { createNeonDevMembershipLookup } from "../bci/neon-dev-membership-rows.ts";
import { createPgReadOnlyTransaction, parseNeonDevConnection } from "../bci/neon-readonly-transaction.ts";
import { createDemandMetaHttpHandler } from "./meta-direct-http.ts";
import { createDemandMetaBciEvidenceHandler } from "./meta-bci-evidence-http.ts";
import { createPgDemandEvidenceAppendTransaction } from "../bci/neon-demand-evidence-append.ts";
import { createDemandMetaPersistedDiagnosisHandler, createDemandMetaReceiptReader } from "./meta-persisted-diagnosis.ts";
import type { PilotTransaction } from "./meta-pilot-ledger.ts";
import { createPgPilotTransaction } from "./meta-pilot-pg.ts";
import {verifyPilotLedger} from "./meta-pilot-ledger-verification.ts";
import {randomBytes} from "node:crypto";

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

/** Fixed-category, server-only Vercel secret shape check. No URI, values or secrets logged. */
type ConnectionShape = "missing" | "url" | "protocol" | "host" | "port" |
  "role" | "password_missing" | "database" | "query_options" | "parser_other";
function connectionShape(value: unknown): ConnectionShape {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return "missing";
  try {
    const uri = new URL(value);
    if (uri.protocol !== "postgres:" && uri.protocol !== "postgresql:") return "protocol";
    if (uri.hostname !== "ep-fancy-queen-b30g0cjn.c-4.ap-southeast-1.aws.neon.tech" &&
        uri.hostname !== "ep-fancy-queen-b30g0cjn-pooler.c-4.ap-southeast-1.aws.neon.tech") return "host";
    if (uri.port && uri.port !== "5432") return "port";
    if (decodeURIComponent(uri.username) !== "bci_dev_membership_reader") return "role";
    if (!uri.password) return "password_missing";
    if (decodeURIComponent(uri.pathname) !== "/bros_intelligence_dev") return "database";
    for (const key of uri.searchParams.keys()) {
      if ((key !== "sslmode" && key !== "channel_binding") ||
          uri.searchParams.getAll(key).length !== 1) return "query_options";
    }
    if (uri.searchParams.has("sslmode") &&
        !["require", "verify-full"].includes(uri.searchParams.get("sslmode")!)) return "query_options";
    if (uri.searchParams.has("channel_binding") &&
        uri.searchParams.get("channel_binding") !== "require") return "query_options";
    if (uri.hash || !uri.username) return "parser_other";
    return "parser_other";
  } catch { return "url"; }
}

/** Server-log diagnostic labels are fixed and per request. No secrets or identifiers. */
type MembershipStep = "configuration" | "connection" | "role" | "posture" | "scope" | "rows";
let membershipPool: Pool | null = null;
function getMemberships(mark: (step: MembershipStep) => void) {
  if (!enabled()) throw new Error("DEMAND_META_PREVIEW_DISABLED");
  if (!membershipPool) {
    mark("configuration");
    let config: ReturnType<typeof parseNeonDevConnection>;
    try {
      config = parseNeonDevConnection(
        process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL,
        "bci_dev_membership_reader",
      );
    } catch {
      // Vercel logs never receive the value, parsed URL, or thrown error.
      console.warn("demand_meta_membership_config_shape",
        connectionShape(process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL));
      throw new Error("BROS_DEMAND_MEMBERSHIP_CONFIG_DENIED");
    }
    // Reuse the restricted pool, but keep diagnostic state request-local.
    const pool = new Pool({ ...config, max: 2, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, allowExitOnIdle: true,
      application_name: "demand-meta-private-preview", query_timeout: 7000 });
    pool.on("error", () => { /* Never log password-bearing driver errors. */ });
    membershipPool = pool;
  }
  const transaction = createPgReadOnlyTransaction(membershipPool);
  return createNeonDevMembershipLookup(async fn => {
    mark("connection");
    return transaction(async query => fn((sql, params) => {
      // Classify ONLY source-owned, fixed SQL patterns; never log SQL or parameters.
      if (sql.startsWith("SELECT current_user AS role_name")) mark("role");
      else if (sql.startsWith("SELECT current_database() AS database_name")) mark("posture");
      else if (sql.startsWith("SELECT set_config(")) mark("scope");
      else if (sql.includes("FROM bci_dev.tenant_memberships")) mark("rows");
      return query(sql, params);
    }));
  });
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
  verifyJwt: async token => {
    let stage: NeonAuthVerifyStage = "structure";
    try {
      return await verifier(token, next => { stage = next; });
    } catch {
      // Fixed request-local enum ONLY: no JWT, claims, keys or error object.
      console.warn("demand_meta_identity_step", stage);
      throw new Error("BROS_DEMAND_IDENTITY_ACCESS_DENIED");
    }
  },
  membershipsFor: async (userId, product) => {
    let step: MembershipStep = "configuration";
    try {
      const grants = await getMemberships(next => { step = next; })(userId, product);
      if (grants.length !== 1) console.warn("demand_meta_membership_step", "no_unique_grant");
      return grants;
    } catch {
      // Fixed vocabulary only. No error objects, subject, role URL or SQL values.
      console.warn("demand_meta_membership_step", step);
      throw new Error("BROS_DEMAND_MEMBERSHIP_ACCESS_DENIED");
    }
  },
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

// Separate, default-OFF evidence action. Existing GET and its flags are unchanged.
let evidenceWriterPool: Pool | undefined;
function getEvidenceWriterPool(): Pool {
  if (!evidenceWriterPool) {
    const config = parseNeonDevConnection(process.env.BCI_NEON_DEV_EVIDENCE_WRITER_DATABASE_URL,
      "bci_dev_evidence_writer_restricted");
    evidenceWriterPool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, allowExitOnIdle: true, query_timeout: 7000,
      application_name: "demand-bci-evidence-dev" });
    evidenceWriterPool.on("error", () => { /* Never log credential-bearing driver errors. */ });
  }
  return evidenceWriterPool;
}
const evidenceHandler = createDemandMetaBciEvidenceHandler({
  enabled: () => enabled() &&
    process.env.BROS_DEMAND_BCI_EVIDENCE_APPEND === "enabled" &&
    Boolean(process.env.BCI_NEON_DEV_EVIDENCE_WRITER_DATABASE_URL),
  accountId: process.env.BROS_DEMAND_META_ACCOUNT_ID ?? "act_0",
  tenantId: process.env.BROS_DEMAND_META_TENANT_ID ?? "",
  apiVersion: process.env.BROS_DEMAND_META_API_VERSION ?? "v26.0",
  verifyJwt: token => verifier(token),
  membershipsFor: (userId, product) => getMemberships(() => {})(userId, product),
  serverTokenFor: async (tenantId, accountId) => {
    if (!enabled() || tenantId !== process.env.BROS_DEMAND_META_TENANT_ID?.toLowerCase() ||
        accountId !== process.env.BROS_DEMAND_META_ACCOUNT_ID) return null;
    return process.env.BROS_DEMAND_META_ADS_READ_TOKEN ?? null;
  },
  now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  transaction: async fn => {
    if (!enabled() || process.env.BROS_DEMAND_BCI_EVIDENCE_APPEND !== "enabled") throw Error();
    return createPgDemandEvidenceAppendTransaction(getEvidenceWriterPool())(fn);
  },
});
export const handleDemandMetaEvidenceAppend = (request: Request) => evidenceHandler(request);



/** Product-only review of the existing immutable receipt; NO Meta call or DB write.
 * Uses the existing restricted physical evidence-writer role in a READ ONLY
 * transaction, with the same branch/flag/JWT/membership security envelope.
 */
const diagnosisHandler = createDemandMetaPersistedDiagnosisHandler({
  enabled: () => enabled() &&
    process.env.BROS_DEMAND_BCI_EVIDENCE_APPEND === "enabled" &&
    Boolean(process.env.BCI_NEON_DEV_EVIDENCE_WRITER_DATABASE_URL),
  tenantId: process.env.BROS_DEMAND_META_TENANT_ID ?? "",
  verifyJwt: token => verifier(token),
  membershipsFor: async (userId, product) => {
    const grants = await getMemberships(() => {})(userId, product);
    if (grants.some(g => g.product !== "demand")) throw Error();
    return grants.map(g => ({ ...g, product: "demand" as const }));
  },
  readReceipt: (tenantId, principalId) =>
    createDemandMetaReceiptReader(createPgReadOnlyTransaction(getEvidenceWriterPool()))(tenantId, principalId),
});
export const handleDemandMetaPersistedDiagnosis = (request: Request) => diagnosisHandler(request);

/** Shared admission for the existing DEMAND app; no second auth service or DB credential. */
const pilotTransaction: PilotTransaction = async fn => {
  if (!enabled() || process.env.BROS_DEMAND_META_PILOT_LEDGER !== "reviewed-v1") throw Error();
  return createPgPilotTransaction(getEvidenceWriterPool())(fn);
};
export const demandMetaPilotRuntime = {
  enabled,
  readToken: () => enabled() && process.env.BROS_DEMAND_META_ACCOUNT_ID === "act_1997776120879476"
    ? process.env.BROS_DEMAND_META_ADS_READ_TOKEN ?? null : null,
  async authorize(jwt: string) {
    if (!enabled()) throw Error();
    const principal = await verifier(jwt);
    if (!principal || principal.authenticated !== true) throw Error();
    const grants = await getMemberships(() => {})(principal.userId, "demand");
    if (grants.length !== 1 || grants[0].active !== true || grants[0].product !== "demand" ||
        grants[0].principalId !== principal.userId ||
        grants[0].tenantId.toLowerCase() !== process.env.BROS_DEMAND_META_TENANT_ID?.toLowerCase()) throw Error();
    return { tenantId: grants[0].tenantId.toLowerCase(), principalId: principal.userId };
  },
  async authorizeContentDemand(jwt: string) {
    // Cross-product candidate generation requires independent active membership
    // in BOTH products for the SAME tenant. This does not authorize publishing.
    const scope = await demandMetaPilotRuntime.authorize(jwt);
    const grants = await getMemberships(() => {})(scope.principalId, "content");
    if (grants.length !== 1 || grants[0].active !== true ||
        grants[0].product !== "content" ||
        grants[0].principalId !== scope.principalId ||
        grants[0].tenantId.toLowerCase() !== scope.tenantId) throw Error();
    return scope;
  },
  transaction: pilotTransaction,
  campaignTransaction: (async fn=>{
    if(!enabled()||process.env.BROS_DEMAND_META_CREATOR_LEDGER!=="reviewed-v1")throw Error();
    return createPgPilotTransaction(getEvidenceWriterPool())(fn);
  }) satisfies PilotTransaction,
  async verifyCampaignLedger(scope:import("./meta-pilot-ledger.ts").PilotScope){
    if(!enabled())throw Error();
    return verifyPilotLedger(getEvidenceWriterPool(),scope,{pausedCampaignPlanSha256:randomBytes(32).toString("hex")});
  },
};

/** Isolated operator status/Insights GET: Preview-only, explicit additional flag, no Meta writes. */
const operatorStatusHandler=createDemandOperatorStatusHandler({
 enabled:()=>enabled() && process.env.BROS_DEMAND_META_OPERATOR_STATUS==="enabled",
 accountId:process.env.BROS_DEMAND_META_ACCOUNT_ID??"act_0",
 campaignId:process.env.BROS_DEMAND_META_CAMPAIGN_ID??"0",
 apiVersion:process.env.BROS_DEMAND_META_API_VERSION??"v26.0",
 authorize:jwt=>demandMetaPilotRuntime.authorize(jwt),
 readToken:()=>demandMetaPilotRuntime.readToken(),
 now:()=>new Date(),
 transport:async(url,init)=>fetch(url,init),
});
export const handleDemandMetaOperatorStatus=(request:Request)=>operatorStatusHandler(request);
