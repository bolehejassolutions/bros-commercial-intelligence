import { createBciDemandMetaEvidenceAppender, type EvidenceAppendTransaction } from "../bci/neon-demand-evidence-append.ts";
import { createDemandDirectMetaReader } from "./meta-direct-admission.ts";
import { projectDemandMetaBciIntake } from "./meta-direct-http.ts";
import type { ReadOnlyMetaFetch } from "./meta-direct-readonly.ts";

type Principal = Readonly<{ userId: string; authenticated: true }>;
type Membership = Readonly<{ principalId: string; tenantId: string; product: "content" | "demand"; active: true }>;
type Dependencies = Readonly<{
  enabled: () => boolean;
  accountId: string;
  tenantId: string;
  apiVersion: string;
  verifyJwt: (token: string) => Promise<Principal | null>;
  membershipsFor: (userId: string, product: "demand") => Promise<readonly Membership[]>;
  serverTokenFor: (tenantId: string, accountId: string) => Promise<string | null>;
  now: () => string;
  transaction: EvidenceAppendTransaction;
  fetchImpl?: ReadOnlyMetaFetch;
}>;
const control = Object.freeze({ accountId: "act_1997776120879476",
  campaignId: "120250864977630697", since: "2026-10-08", until: "2026-10-27" });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache",
  Vary: "Authorization", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status: number, extra?: Record<string, string>) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });
const deny = (status: number) => json({ error: "BROS DEMAND DEV evidence action denied." }, status);

/** Next.js can supply an empty POST as a non-null stream. Reject actual bytes,
 * not the presence of the framework's stream wrapper. Read at most one chunk,
 * bound the wait and cancel; never parse, log or accept a request payload. */
async function hasEmptyBody(request: Request): Promise<boolean> {
  if (request.body === null) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read().then(result => result.done === true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000); }),
    ]);
  } catch { return false; }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
}

/** One explicit authenticated DEV POST. GET reporting never writes.
 * No request body, caller scope, provider payload, token, date or campaign is accepted.
 * Meta is read once on the server. Existing shared BCI code commits the observation,
 * then verifies the identical snapshot in a second transaction after COMMIT.
 * A separate provider readback is still required for independent acceptance.
 */
export function createDemandMetaBciEvidenceHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return deny(404);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    let url: URL;
    try { url = new URL(request.url); } catch { return deny(400); }
    if (request.url.length > 2048 || url.pathname !== "/api/internal/demand-meta-evidence" ||
        url.search !== "" || request.headers.has("transfer-encoding") ||
        Number(request.headers.get("content-length") || 0) !== 0 ||
        request.headers.get("origin") !== url.origin ||
        (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin") ||
        ["x-tenant-id", "x-user-id", "x-principal-id", "x-bci-tenant-id", "x-admin",
         "x-role", "x-product", "x-operator-id", "x-meta-token"].some(k => request.headers.has(k))) {
      console.warn("demand_meta_evidence_http_denied", "request_shape");
      return deny(400);
    }
    if (!(await hasEmptyBody(request))) {
      console.warn("demand_meta_evidence_http_denied", "body_not_empty_or_readable");
      return deny(400);
    }
    const authorization = request.headers.get("authorization");
    if (!authorization || authorization.length > 16007 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) return deny(401);
    const token = authorization.slice(7);
    let phase: "configuration" | "identity" | "membership" | "provider" | "append" | "replay" = "configuration";
    let firstCommitted = false;
    try {
      if (deps.accountId !== control.accountId || !uuid.test(deps.tenantId)) throw Error();
      const tenantId = deps.tenantId.toLowerCase();
      const memberships = async (userId: string) => {
        phase = "membership";
        const grants = await deps.membershipsFor(userId, "demand");
        if (grants.length !== 1 || grants[0].principalId !== userId ||
            grants[0].tenantId.toLowerCase() !== tenantId ||
            grants[0].product !== "demand" || grants[0].active !== true) throw Error();
        return [{ ...grants[0], product: "demand" as const }];
      };
      const authenticate = () => { phase = "identity"; return deps.verifyJwt(token); };
      const reader = createDemandDirectMetaReader({ accountId: control.accountId,
        campaignId: control.campaignId, apiVersion: deps.apiVersion }, {
        authenticate,
        membershipsFor: userId => memberships(userId),
        serverTokenFor: (tenant, account) => { phase = "provider"; return deps.serverTokenFor(tenant, account); },
        now: deps.now,
        fetchImpl: (url, init) => { phase = "provider"; return (deps.fetchImpl ?? fetch)(url, init); },
      });
      // Request-local only: neither a JWT nor a provider snapshot crosses requests.
      let snapshot: ReturnType<typeof projectDemandMetaBciIntake> | undefined;
      const append = createBciDemandMetaEvidenceAppender({ fixedCampaign: control,
        authenticate, membershipsFor: memberships,
        observeServerMeta: async () => {
          if (!snapshot) {
            const result = await reader({ since: control.since, until: control.until });
            if (!result || result.status !== "CAMPAIGN_ROW_OBSERVED_UNATTESTED") throw Error();
            snapshot = projectDemandMetaBciIntake(result);
          }
          return snapshot;
        }, transaction: async fn => {
          phase = firstCommitted ? "replay" : "append";
          return deps.transaction(fn);
        },
      });
      const first = await append(); // returns only AFTER the first transaction commits
      firstCommitted = true;
      const replay = await append(); // fresh auth/membership and second DB transaction
      if (!uuid.test(first.recordId) || replay.status !== "replayed" ||
          replay.recordId !== first.recordId || !snapshot) throw Error();
      return json({ status: first.status, recordId: first.recordId,
        source: "DIRECT_META_GRAPH_API", durableBciEvidenceRecorded: true,
        postCommitReplayVerified: true, independentlyAttestedProvider: false,
        verifiedPaidOrders: null, campaignExecutionAllowed: false }, 200);
    } catch {
      // Fixed server-only categories. Never log request/body/JWT, principal,
      // connection details, provider payload or secret-bearing error objects.
      console.warn("demand_meta_evidence_action_denied", phase,
        firstCommitted ? "after_first_commit" : "before_first_commit");
      // A first append may have committed before a later check failed. A retry
      // uses the immutable unique key; never overwrite or claim atomic multi-step completion.
      return deny(403);
    }
  };
}
