/** Browser-only negative probes for the protected internal Preview.
 * These exercise request rejection with the owner's existing short-lived token.
 * They do NOT establish cross-tenant RLS, revoked membership or independent
 * hosted verification. No token, response body or principal is retained.
 */
export type PreviewNegativeCheck = Readonly<{ id: string; passed: boolean }>;
export type PreviewNegativeReport = Readonly<{
  passed: number;
  total: number;
  authenticatedControlsPassed: number;
  authenticatedControlsTotal: number;
  checks: readonly PreviewNegativeCheck[];
}>;
type Probe = Readonly<{ id: string; path: string; expected: number; method?: "POST"; extraHeader?: readonly [string,string]; bearer: boolean }>;
const probes: readonly Probe[] = [
  { id: "missing_bearer", path: "?product=content", expected: 401, bearer: false },
  { id: "tenant_override", path: "?product=content&tenantId=11111111-1111-4111-8111-111111111111", expected: 400, bearer: true },
  { id: "principal_override", path: "?product=content&userId=11111111-1111-4111-8111-111111111111", expected: 400, bearer: true },
  { id: "duplicate_product", path: "?product=content&product=demand", expected: 400, bearer: true },
  { id: "admin_header", path: "?product=content", expected: 400, bearer: true, extraHeader: ["x-role","BROS"] },
  { id: "product_header", path: "?product=content", expected: 400, bearer: true, extraHeader: ["x-product","demand"] },
  { id: "write_method", path: "?product=content", expected: 405, bearer: true, method: "POST" },
];
const controlProducts = ["content", "demand"] as const;
/** Development-only cross-tenant smoke: the approved operator's internal tenant
 * currently has zero CONTENT and DEMAND evidence rows, while separate synthetic
 * tenants have populated rows. A provider-authenticated GET must not return any
 * of those other tenants' rows. Run only while the internal tenant is known empty.
 * This is NOT a substitute for revoked-membership, direct LOGIN, or adversarial
 * multi-tenant end-to-end tests. Never return or log response bodies or tokens.
 */
export async function runNeonPreviewEmptyTenantIsolationSmoke(
  token: string, request: typeof fetch = fetch,
): Promise<Readonly<{ passed: number; total: 2 }>> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
      token.length > 16000) throw new Error("Invalid preview token");
  let passed = 0;
  for (const product of controlProducts) {
    try {
      const response = await request(`/api/internal/neon-evidence?product=${product}&limit=50`, {
        method: "GET", headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", redirect: "error",
      });
      if (response.status !== 200 || !safeHeaders(response)) continue;
      const raw = await response.text();
      if (raw.length > 65536) continue;
      const body: unknown = JSON.parse(raw);
      if (body === null || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 2 || !("scope" in body) ||
          body.scope !== "internal-development" || !("evidence" in body) ||
          !Array.isArray(body.evidence) || body.evidence.length !== 0) continue;
      passed++;
    } catch { /* Failure is counted, not logged. */ }
  }
  return Object.freeze({ passed, total: 2 as const });
}

const safeHeaders = (response: Response) =>
  /no-store/i.test(response.headers.get("cache-control") ?? "") &&
  /Authorization/i.test(response.headers.get("vary") ?? "");

/** A denial is only a PASS if the response contains the exact generic envelope.
 * Merely returning the expected HTTP status must not conceal leaked private data.
 */
const safeDenial = (raw: string, status: number): boolean => {
  if (raw.length > 2048) return false;
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return false; }
  return body !== null && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body).length === 1 && "error" in body &&
    body.error === (status === 405 ? "Method not allowed." : "BCI private evidence access denied.");
};

/** Positive authenticated controls prevent false 7/7 when the bearer is invalid or expired. */
export async function runNeonPreviewNegativeChecks(
  token: string, request: typeof fetch = fetch,
): Promise<PreviewNegativeReport> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
      token.length > 16000) throw new Error("Invalid preview token");
  let authenticatedControlsPassed = 0;
  for (const product of controlProducts) {
    try {
      const response = await request(`/api/internal/neon-evidence?product=${product}&limit=1`, {
        method: "GET", headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", redirect: "error",
      });
      if (response.status !== 200 || !safeHeaders(response)) throw new Error();
      const raw = await response.text();
      if (raw.length > 65536) throw new Error();
      const body: unknown = JSON.parse(raw);
      if (body === null || typeof body !== "object" || Array.isArray(body) ||
          !("scope" in body) || body.scope !== "internal-development" ||
          !("evidence" in body) || !Array.isArray(body.evidence) || body.evidence.length > 1 ||
          !body.evidence.every((row: unknown) => row !== null && typeof row === "object" &&
            !Array.isArray(row) && "product" in row && row.product === product)) throw new Error();
      authenticatedControlsPassed++;
    } catch {
      // Never retain response bodies, tokens, identifiers or raw provider errors.
      throw new Error("Authenticated preview controls failed");
    }
  }
  const checks: PreviewNegativeCheck[] = [];
  for (const probe of probes) {
    try {
      const headers: Record<string,string> = probe.bearer ? { Authorization: `Bearer ${token}` } : {};
      if (probe.extraHeader) headers[probe.extraHeader[0]] = probe.extraHeader[1];
      const response = await request(`/api/internal/neon-evidence${probe.path}`, {
        method: probe.method ?? "GET", headers, cache: "no-store", redirect: "error",
      });
      const raw = await response.text();
      const passed = response.status === probe.expected && safeHeaders(response) &&
        safeDenial(raw, probe.expected);
      checks.push(Object.freeze({ id: probe.id, passed }));
    } catch {
      checks.push(Object.freeze({ id: probe.id, passed: false }));
    }
  }
  return Object.freeze({ passed: checks.filter(check => check.passed).length,
    total: checks.length, authenticatedControlsPassed,
    authenticatedControlsTotal: controlProducts.length, checks: Object.freeze(checks) });
}
