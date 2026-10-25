/**
 * Preview-only HTTP adapter for the private BCI evidence reader.
 * This is a pure handler factory, NOT a registered Next.js route or a deployed API.
 * The host must inject a real Neon Auth JWT verifier, authoritative restricted
 * membership lookup and a separate restricted evidence DB reader. Never inject
 * an admin/BROS DB connection or derive principal/tenant from request headers.
 */
import {
  createPrivateEvidenceReader,
  type BciProduct,
  type PrivateEvidenceDependencies,
} from "./private-evidence-boundary.ts";

type Principal = Readonly<{ userId: string; authenticated: true }>;
export type PrivateEvidenceHttpDependencies = Readonly<{
  verifyBearer: (token: string) => Promise<Principal | null>;
  membershipsFor: PrivateEvidenceDependencies["membershipsFor"];
  readRows: PrivateEvidenceDependencies["readRows"];
}>;

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json; charset=utf-8",
} as const;
const denied = (status: number): Response =>
  new Response(JSON.stringify({ error: "Request denied" }), { status, headers: responseHeaders });

/** Never creates a session or a tenant grant; every request rechecks both. */
export function createPrivateEvidenceHttpHandler(deps: PrivateEvidenceHttpDependencies) {
  if (!deps || typeof deps.verifyBearer !== "function" ||
      typeof deps.membershipsFor !== "function" || typeof deps.readRows !== "function") {
    throw new TypeError("Private evidence HTTP dependencies are required");
  }
  return async (request: Request): Promise<Response> => {
    // Fail closed even if a future developer accidentally mounts this handler.
    if (process.env.VERCEL_ENV !== "preview" ||
        process.env.BCI_NEON_DEV_PRIVATE_READS !== "enabled") return denied(404);
    if (request.method !== "GET") return denied(405);
    let url: URL;
    try { url = new URL(request.url); } catch { return denied(400); }
    if (url.pathname !== "/api/internal/bci/evidence" ||
        [...url.searchParams.keys()].some(k => k !== "product" && k !== "limit") ||
        url.searchParams.getAll("product").length !== 1 ||
        url.searchParams.getAll("limit").length > 1) return denied(400);
    // Reject identity/tenant hints rather than silently accepting spoofed claims.
    if (["x-user-id", "x-tenant-id", "x-admin", "x-product"].some(k => request.headers.has(k))) return denied(400);
    const product = url.searchParams.get("product");
    if (product !== "content" && product !== "demand") return denied(400);
    const rawLimit = url.searchParams.get("limit");
    if (rawLimit !== null && (!/^[1-9][0-9]?$/.test(rawLimit) || Number(rawLimit) > 50)) return denied(400);
    const authorization = request.headers.get("authorization");
    if (!authorization || !/^Bearer [A-Za-z0-9._-]{10,16000}$/.test(authorization)) return denied(401);
    const token = authorization.slice(7);
    try {
      const reader = createPrivateEvidenceReader({
        authenticate: () => deps.verifyBearer(token),
        membershipsFor: deps.membershipsFor,
        readRows: deps.readRows,
      });
      const rows = await reader({ product: product as BciProduct,
        ...(rawLimit === null ? {} : { limit: Number(rawLimit) }) });
      return new Response(JSON.stringify({ data: rows }), { status: 200, headers: responseHeaders });
    } catch {
      // Do not leak whether JWT, membership, database, or RLS caused rejection.
      return denied(403);
    }
  };
}
