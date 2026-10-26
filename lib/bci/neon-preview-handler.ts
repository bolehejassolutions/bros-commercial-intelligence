/** Private, development-only HTTP boundary; never accepts tenant identity from a request. */
import { createNeonAuthPrincipalVerifier, type NeonAuthVerifierConfig } from "./neon-auth-principal.ts";
import { createPrivateEvidenceReader, type PrivateEvidenceDependencies } from "./private-evidence-boundary.ts";

export const NEON_PREVIEW_BRANCH = "feat/neon-bci-dev-ledger-20261025";
export type NeonPreviewEnvironment = Readonly<Record<string, string | undefined>>;

export function isNeonPreviewEnabled(env: NeonPreviewEnvironment): boolean {
  return env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF === NEON_PREVIEW_BRANCH &&
    env.BCI_NEON_DEV_PRIVATE_READS === "enabled";
}

type Dependencies = Readonly<{
  env: () => NeonPreviewEnvironment;
  verifierConfig: NeonAuthVerifierConfig;
  membershipsFor: PrivateEvidenceDependencies["membershipsFor"];
  readRows: PrivateEvidenceDependencies["readRows"];
}>;

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status: number, extra?: Record<string, string>) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });
const denied = (status: number) => json({ error: "BCI private evidence access denied." }, status);

/** Uses the real signature verifier before authoritative membership and scoped database reads. */
export function createNeonPreviewHandler(deps: Dependencies) {
  const verify = createNeonAuthPrincipalVerifier({
    ...deps.verifierConfig,
    approvedOperator: { email: "rasymokh@gmail.com" },
  });
  return async (request: Request): Promise<Response> => {
    if (!isNeonPreviewEnabled(deps.env())) return denied(404);
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    if (request.url.length > 4096 || Number(request.headers.get("content-length") || 0) !== 0 ||
        request.headers.has("transfer-encoding")) return denied(400);
    let url: URL;
    try { url = new URL(request.url); } catch { return denied(400); }
    // Route identity is fixed by the server, not caller-provided path or role hints.
    // Check here as well as in Next.js routing so direct handler reuse fails closed.
    if (url.pathname !== "/api/internal/neon-evidence" ||
        [...url.searchParams.keys()].some(key => key !== "product" && key !== "limit") ||
        url.searchParams.getAll("product").length !== 1 || url.searchParams.getAll("limit").length > 1 ||
        ["x-tenant-id", "x-user-id", "x-principal-id", "x-bci-tenant-id",
         "x-admin", "x-role", "x-product", "x-operator-id"].some(key => request.headers.has(key))) {
      return denied(400);
    }
    const product = url.searchParams.get("product");
    const rawLimit = url.searchParams.get("limit");
    if ((product !== "content" && product !== "demand") ||
        (rawLimit !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit))) return denied(400);
    const authorization = request.headers.get("authorization");
    if (!authorization || authorization.length > 16007 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) return denied(401);
    const token = authorization.slice(7);
    try {
      // The closure is request-local. No token, principal or membership is cached across requests.
      const reader = createPrivateEvidenceReader({
        authenticate: () => verify(token),
        membershipsFor: deps.membershipsFor,
        readRows: deps.readRows,
      });
      const evidence = await reader({ product, ...(rawLimit === null ? {} : { limit: Number(rawLimit) }) });
      return json({ evidence, scope: "internal-development" }, 200);
    } catch {
      // Never serialize provider/driver errors, connection strings, tokens or SQL parameters.
      return denied(403);
    }
  };
}
