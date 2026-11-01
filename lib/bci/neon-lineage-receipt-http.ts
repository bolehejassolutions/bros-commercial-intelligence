/** Narrow signed DEV-only HTTP admission; no browser-controlled receipt, scope or body. */
import { isNeonPreviewEnabled, type NeonPreviewEnvironment } from "./neon-preview-handler.ts";
const receipt = "4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache",
  "Vary": "Authorization", "X-Content-Type-Options": "nosniff" };
const json = (data: unknown, status: number, extra?: Record<string,string>) =>
  Response.json(data, { status, headers: { ...headers, ...extra } });
const deny = (status: number) => json({ error: "BCI private lineage receipt denied." }, status);
type Result = Readonly<{ receiptId: string; status: "inserted" | "replayed";
  stage: "evidence"; verification: "unverified"; providerAttested: false }>;
type Env = NeonPreviewEnvironment & { BCI_NEON_DEV_LINEAGE_RECEIPT_WRITES?: string };
type Deps = Readonly<{ env: () => Env; execute: (jwt: string) => Promise<Result> }>;
export function createLineageReceiptHttpHandler(deps: Deps) {
  return async (request: Request): Promise<Response> => {
    const env = deps.env();
    if (!isNeonPreviewEnabled(env) ||
        env.BCI_NEON_DEV_LINEAGE_RECEIPT_WRITES !== "enabled") return deny(404);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    let url: URL; try { url = new URL(request.url); } catch { return deny(400); }
    if (url.pathname !== "/api/internal/neon-lineage-receipt" || url.search || url.hash ||
        request.url.length > 4096 ||
        request.headers.has("content-type") || request.headers.has("transfer-encoding") ||
        Number(request.headers.get("content-length") || 0) !== 0 ||
        ["x-tenant-id","x-principal-id","x-user-id","x-role","x-admin","x-product","x-receipt-id"]
          .some(key => request.headers.has(key))) return deny(400);
    // A valid empty POST may arrive as a zero-byte ReadableStream in hosted runtimes.
    // Reject the first emitted chunk (including empty chunks) to fail closed on payloads.
    if (request.body !== null) {
      try {
        const reader = request.body.getReader();
        const first = await reader.read();
        await reader.cancel();
        if (!first.done) return deny(400);
      } catch { return deny(400); }
    }
    if (request.headers.get("origin") !== url.origin ||
        (request.headers.has("sec-fetch-site") &&
         request.headers.get("sec-fetch-site") !== "same-origin")) return deny(403);
    const auth = request.headers.get("authorization");
    if (!auth || auth.length > 16007 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth)) return deny(401);
    try {
      const result = await deps.execute(auth.slice(7));
      if (!result || result.receiptId !== receipt ||
          !["inserted","replayed"].includes(result.status) ||
          result.stage !== "evidence" || result.verification !== "unverified" ||
          result.providerAttested !== false) return deny(403);
      return json({ receiptId: receipt, status: result.status, stage: "evidence",
        verification: "unverified", providerAttested: false }, 200);
    } catch { return deny(403); }
  };
}
