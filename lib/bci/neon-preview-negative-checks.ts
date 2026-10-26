/** Browser-only negative probes for the protected internal Preview.
 * These exercise request rejection with the owner's existing short-lived token.
 * They do NOT establish cross-tenant RLS, revoked membership or independent
 * hosted verification. No token, response body or principal is retained.
 */
export type PreviewNegativeCheck = Readonly<{ id: string; passed: boolean }>;
export type PreviewNegativeReport = Readonly<{
  passed: number;
  total: number;
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
export async function runNeonPreviewNegativeChecks(
  token: string, request: typeof fetch = fetch,
): Promise<PreviewNegativeReport> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
      token.length > 16000) throw new Error("Invalid preview token");
  const checks: PreviewNegativeCheck[] = [];
  for (const probe of probes) {
    try {
      const headers: Record<string,string> = probe.bearer ? { Authorization: `Bearer ${token}` } : {};
      if (probe.extraHeader) headers[probe.extraHeader[0]] = probe.extraHeader[1];
      const response = await request(`/api/internal/neon-evidence${probe.path}`, {
        method: probe.method ?? "GET", headers, cache: "no-store", redirect: "error",
      });
      const raw = await response.text();
      const passed = response.status === probe.expected &&
        /no-store/i.test(response.headers.get("cache-control") ?? "") &&
        /Authorization/i.test(response.headers.get("vary") ?? "") &&
        !/"evidence"\s*:/.test(raw);
      checks.push(Object.freeze({ id: probe.id, passed }));
    } catch {
      checks.push(Object.freeze({ id: probe.id, passed: false }));
    }
  }
  return Object.freeze({ passed: checks.filter(check => check.passed).length,
    total: checks.length, checks: Object.freeze(checks) });
}
