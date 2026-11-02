import type { PilotScope } from "./meta-pilot-ledger.ts";
import { PilotReconciliationRequired } from "./meta-pilot-ledger.ts";
import type { createPilotService } from "./meta-pilot-service.ts";

type Service = ReturnType<typeof createPilotService>;
type Dependencies = {
  enabled: () => boolean;
  authorize: (jwt: string) => Promise<PilotScope>;
  service: (scope: PilotScope, reauthorize: () => Promise<void>) => Service;
};
const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache",
  Vary: "Authorization", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers });
async function boundedForm(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw Error();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const r = await reader.read(); if (r.done) break;
      size += r.value.length; if (size > 1050000) { await reader.cancel(); throw Error(); }
      chunks.push(r.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    return new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
  } finally { reader.releaseLock(); }
}
export function createPilotHttpHandler(deps: Dependencies) {
  return async (request: Request) => {
    if (!deps.enabled()) return json({ error: "Private campaign controls unavailable." }, 404);
    if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
    const url = new URL(request.url);
    if (url.pathname !== "/api/internal/demand-meta-pilot" || url.search || request.url.length > 2048 ||
        ["x-tenant-id", "x-user-id", "x-role", "x-admin", "x-meta-token", "x-product", "x-bci-tenant-id"].some(k => request.headers.has(k)) ||
        request.headers.has("transfer-encoding") ||
        Number(request.headers.get("content-length") ?? "0") > 1050000 ||
        (request.method === "GET" && request.body !== null) ||
        (request.method === "POST" && (request.headers.get("origin") !== url.origin ||
          !request.headers.get("content-type")?.startsWith("multipart/form-data;"))))
      return json({ error: "Campaign request rejected." }, 400);
    const auth = request.headers.get("authorization");
    if (!auth || auth.length > 16007 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))
      return json({ error: "Sign in to check campaign controls." }, 401);
    const jwt = auth.slice(7);
    let scope: PilotScope;
    try { scope = await deps.authorize(jwt); } catch { return json({ error: "Operator access denied." }, 403); }
    const reauthorize = async () => {
      const fresh = await deps.authorize(jwt);
      if (fresh.tenantId !== scope.tenantId || fresh.principalId !== scope.principalId) throw Error();
    };
    const service = deps.service(scope, reauthorize);
    try {
      if (request.method === "GET") return json(await service.readiness(scope), 200);
      let form: FormData;
      try { form = await boundedForm(request); } catch { return json({ error: "Campaign form rejected." }, 400); }
      const action = form.get("action");
      if (form.getAll("action").length !== 1 || !["stage", "activate", "pause"].includes(String(action)) ||
          [...form.keys()].some(k => !["action", "a", "b"].includes(k)))
        return json({ error: "Campaign action rejected." }, 400);
      if (action === "stage") {
        const a = form.get("a"), b = form.get("b");
        if (!(a instanceof File) || !(b instanceof File) || form.getAll("a").length !== 1 ||
            form.getAll("b").length !== 1 || a.size !== 465709 || b.size !== 452762)
          return json({ error: "Both approved V5 image files are required." }, 400);
        return json(await service.stage(scope, { a: new Uint8Array(await a.arrayBuffer()), b: new Uint8Array(await b.arrayBuffer()) }), 200);
      }
      if ([...form.keys()].length !== 1) return json({ error: "Unexpected campaign input." }, 400);
      return json(action === "pause" ? await service.pause(scope) : await service.activate(scope), 200);
    } catch (error) {
      // Never return raw driver/provider errors, tokens, URLs, IDs from request input or SQL.
      return error instanceof PilotReconciliationRequired ? json({ error:
        "An action may have committed. Stop and reconcile Meta and the ledger before retrying.", reconcileRequired: true }, 409) :
        json({ error: "Campaign action blocked. Refresh readiness; no execution is certified." }, 409);
    }
  };
}
