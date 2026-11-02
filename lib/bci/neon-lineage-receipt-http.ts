/** Narrow signed DEV-only HTTP admission; no browser-controlled receipt, scope or body. */
import { isNeonPreviewEnabled, type NeonPreviewEnvironment } from "./neon-preview-handler.ts";
import type { DemandSignalResult } from "./neon-demand-signal.ts";
const receipt = "4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache",
  "Vary": "Authorization", "X-Content-Type-Options": "nosniff" };
const json = (data: unknown, status: number, extra?: Record<string,string>) =>
  Response.json(data, { status, headers: { ...headers, ...extra } });
const deny = (status: number) => json({ error: "BCI private lineage receipt denied." }, status);
type Result = Readonly<{ receiptId: string; status: "inserted" | "replayed";
  stage: "evidence"; verification: "unverified"; providerAttested: false }>;
type Env = NeonPreviewEnvironment & { BCI_NEON_DEV_LINEAGE_RECEIPT_WRITES?: string;
  BCI_NEON_DEV_DEMAND_SIGNAL_WRITES?: string };
type Deps = Readonly<{ env: () => Env; execute: (jwt: string) => Promise<Result>;
  executeSignal?: (jwt: string) => Promise<DemandSignalResult> }>;
export function createLineageReceiptHttpHandler(deps: Deps) {
  return async (request: Request): Promise<Response> => {
    const env = deps.env();
    let url: URL; try { url = new URL(request.url); } catch { return deny(400); }
    const signalOperation = url.search === "?operation=demand-meta-observation-v1";
    if (!isNeonPreviewEnabled(env) ||
        (signalOperation ? env.BCI_NEON_DEV_DEMAND_SIGNAL_WRITES !== "enabled" ||
          typeof deps.executeSignal !== "function" :
          env.BCI_NEON_DEV_LINEAGE_RECEIPT_WRITES !== "enabled")) return deny(404);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    if (url.pathname !== "/api/internal/neon-lineage-receipt" ||
        (!signalOperation && url.search !== "") || url.hash ||
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
      if (signalOperation) {
        const result = await deps.executeSignal!(auth.slice(7));
        if (!result || Reflect.ownKeys(result).length !== 10 || result.receiptId !== receipt ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result.signalId) ||
            result.signalVersion !== "DEMAND_META_OBSERVATION_V1" ||
            !["inserted", "replayed"].includes(result.status) || result.stage !== "signal" ||
            result.verification !== "unverified" || !/^[0-9a-f]{64}$/.test(result.sourceSha256) ||
            result.postCommitReadback !== true || result.providerAttested !== false ||
            result.actionAuthorized !== false) return deny(403);
        return json({ receiptId: receipt, signalId: result.signalId, signalVersion: result.signalVersion,
          status: result.status, stage: "signal", verification: "unverified", sourceSha256: result.sourceSha256,
          postCommitReadback: true, providerAttested: false, actionAuthorized: false }, 200);
      }
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

