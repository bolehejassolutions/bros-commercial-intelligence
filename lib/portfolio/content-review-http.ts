type Scope = Readonly<{ tenantId: string; principalId: string; product: "content" }>;
type Sources = ReturnType<typeof import("./content-review-source.mjs").createContentReviewSourceStore>;
type Mode = "content" | "demand-reuse";
type Setup = Readonly<{ ready: boolean; missing: string[]; registeredKeyIds: string[]; demandReuseAvailable: boolean }>;
type Dependencies = Readonly<{
  mode: () => Mode | null;
  authorize: (jwt: string, mode: Mode) => Promise<Scope>;
  sources: Sources;
  setup: (mode: Mode) => Setup;
}>;

const headers = {
  "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache",
  Vary: "Authorization", "X-Content-Type-Options": "nosniff",
};
const scopeHeaders = ["x-tenant-id", "x-user-id", "x-role", "x-admin", "x-product", "x-principal-id", "x-bci-tenant-id"];
const json = (body: unknown, status: number) => Response.json(body, { status, headers });

export function createContentReviewReadHandler(deps: Dependencies) {
  return async (request: Request) => {
    const mode = deps.mode();
    if (!mode) return json({ error: "Unavailable." }, 404);
    if (request.method !== "GET") return Response.json({ error: "Method not allowed." },
      { status: 405, headers: { ...headers, Allow: "GET" } });
    const url = new URL(request.url);
    const proof = url.searchParams.get("proof");
    if (url.pathname !== "/api/internal/neon-content-review" ||
        url.searchParams.size !== (proof === null ? 0 : 1) ||
        (proof !== null && !/^content-instance-script-proof-[a-f0-9]{64}$/.test(proof)) ||
        scopeHeaders.some(key => request.headers.has(key))) return json({ error: "Invalid request." }, 400);
    const auth = request.headers.get("authorization");
    if (!auth || auth.length > 16007 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))
      return json({ error: "Sign in to review content." }, 401);
    try {
      const jwt = auth.slice(7);
      const scope = await deps.authorize(jwt, mode);
      const source = proof === null ? { sources: await deps.sources.list(scope) } : await deps.sources.load(scope, proof);
      const current = await deps.authorize(jwt, mode);
      if (deps.mode() !== mode || current.principalId !== scope.principalId || current.tenantId !== scope.tenantId)
        throw Error();
      const body = "sources" in source ? source : {
        title: source.title, envelope: source.envelope, handoff: source.handoff,
        images: source.mediaBytes.map(bytes => "data:image/png;base64," + Buffer.from(bytes).toString("base64")),
      };
      return json({ ...body, reviewerSubject: scope.principalId, setup: deps.setup(mode), providerSent: false }, 200);
    } catch {
      return json({ error: "Content review could not be confirmed. Sign in and try again." }, 403);
    }
  };
}
