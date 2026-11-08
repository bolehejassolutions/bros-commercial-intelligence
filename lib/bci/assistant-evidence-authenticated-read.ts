/**
 * DEV-only, no-route adapter for the BROS Business OS read-only evidence contract.
 * No credentials, real session verifier, database or MCP endpoint are bundled.
 * Injections are trusted SERVER code; never construct them from request claims.
 */
import { projectReadOnlyEvidence } from "./assistant-evidence-bridge.ts";
import type { BciProduct, EvidenceRow, ReadOnlyEvidenceSnapshot } from "./assistant-evidence-bridge.ts";

type Selection = Readonly<{ tenantId: string; product: BciProduct }>;
type VerifiedPrincipal = Readonly<{ subjectId: string; expiresAt: string; sessionId?: string }>;

export interface ReadEvidenceDependencies {
  /** Check cryptographic token issuer/audience/expiry AND live revocation, on each call. */
  readonly verifyBearerToken: (token: string) => Promise<VerifiedPrincipal | null>;
  /** Live SERVER-side authoritative membership/product read permission; called twice. */
  readonly hasEvidenceReadGrant: (subjectId: string, scope: Selection) => Promise<boolean>;
  /** Independently enforce the SAME tenant/product/limit in the backing DB query. */
  readonly listScopedReceipts: (
    scope: Selection & Readonly<{ maxRows: 20 }>
  ) => Promise<readonly EvidenceRow[]>;
  readonly now?: () => number;
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DEV_PATH = "/internal/dev/bros-business-os/evidence";
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function parseScope(request: Request): Selection | null {
  let url: URL;
  try { url = new URL(request.url); } catch { return null; }
  if (url.pathname !== DEV_PATH || url.searchParams.size !== 2 ||
      url.searchParams.getAll("tenant_id").length !== 1 ||
      url.searchParams.getAll("product").length !== 1) return null;
  const tenantId = url.searchParams.get("tenant_id");
  const product = url.searchParams.get("product");
  if (!tenantId || !ID.test(tenantId) ||
      (product !== "content" && product !== "demand")) return null;
  return { tenantId, product };
}

function parseBearer(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth || auth.length > 4103) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/.exec(auth);
  return match?.[1] ?? null;
}

/**
 * A testable HTTP contract, NOT an HTTP route or authentication provider.
 * Do not attach to live Next.js routing until token verification, DB isolation,
 * revocation, rate limits, logs and production security gates are approved.
 */
export function createDevEvidenceReadHandler(deps: ReadEvidenceDependencies) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "GET") return reply(405, { error: "method_not_allowed" });
    if (process.env.NODE_ENV === "production") return reply(503, { error: "not_available" });
    const selection = parseScope(request);
    if (!selection) return reply(400, { error: "invalid_scope" });
    const token = parseBearer(request);
    if (!token) return reply(401, { error: "authentication_required" });
    if (!deps || typeof deps.verifyBearerToken !== "function" ||
        typeof deps.hasEvidenceReadGrant !== "function" ||
        typeof deps.listScopedReceipts !== "function") {
      return reply(503, { error: "not_available" });
    }
    try {
      const principal = await deps.verifyBearerToken(token);
      const now = deps.now ? deps.now() : Date.now();
      if (!principal || typeof principal.subjectId !== "string" ||
          !ID.test(principal.subjectId) || typeof principal.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(principal.expiresAt)) ||
          !Number.isFinite(now) || Date.parse(principal.expiresAt) <= now) {
        return reply(401, { error: "authentication_required" });
      }
      const granted = await deps.hasEvidenceReadGrant(principal.subjectId, selection);
      if (granted !== true) return reply(403, { error: "access_denied" });
      const rows = await deps.listScopedReceipts({ ...selection, maxRows: 20 });
      // A restricted repository must enforce its SQL LIMIT independently; never
      // silently truncate an oversized result and misrepresent it as a complete read.
      if (!Array.isArray(rows) || rows.length > 20) return reply(503, { error: "read_unavailable" });
      // A repository returning another tenant or product is an isolation breach,
      // not an empty-data result. Deny the whole read before projecting anything.
      if (rows.some(row => !row || row.tenantId !== selection.tenantId ||
          row.product !== selection.product)) {
        return reply(503, { error: "read_unavailable" });
      }
      // Revalidate the SAME bearer identity and authoritative product grant just
      // before disclosure. Revocation, expiry or tenant/product reassignment may
      // occur while the independent restricted SQL read is in flight. These
      // checks narrow the race; they cannot make separate stores atomic.
      const stillVerified = await deps.verifyBearerToken(token);
      const nowAfterRead = deps.now ? deps.now() : Date.now();
      if (!stillVerified || stillVerified.subjectId !== principal.subjectId ||
          stillVerified.expiresAt !== principal.expiresAt ||
          (principal.sessionId !== undefined &&
            (typeof principal.sessionId !== "string" || !ID.test(principal.sessionId) ||
              stillVerified.sessionId !== principal.sessionId)) ||
          !Number.isFinite(nowAfterRead) ||
          Date.parse(principal.expiresAt) <= nowAfterRead) {
        return reply(401, { error: "authentication_required" });
      }
      const stillGranted = await deps.hasEvidenceReadGrant(principal.subjectId, selection);
      if (stillGranted !== true) return reply(403, { error: "access_denied" });
      const scoped = {
        identityVerifiedByServer: true as const,
        tenantMembershipVerifiedByServer: true as const,
        subjectId: principal.subjectId,
        tenantId: selection.tenantId,
        product: selection.product,
        scopes: ["evidence:read"] as const,
      };
      const snapshot: ReadOnlyEvidenceSnapshot = projectReadOnlyEvidence(scoped, rows);
      return reply(200, snapshot);
    } catch {
      // Never leak server errors, credentials or raw tenant evidence to the caller.
      return reply(503, { error: "read_unavailable" });
    }
  };
}
