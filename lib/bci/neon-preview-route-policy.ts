/** Exact paths protected by their own Preview-only Neon authentication boundary. */
const neonPreviewPaths = new Set([
  "/api/internal/neon-evidence",
  "/api/internal/neon-demand-case",
  "/api/internal/neon-lineage-receipt",
  "/api/internal/neon-demand-proposal",
  "/api/internal/neon-content-reservation",
  "/api/internal/neon-content-review",
  "/api/internal/neon-content-approval",
  "/internal/neon-preview",
  "/internal/neon-preview/content-review",
  "/internal/demand-meta-test",
  "/api/internal/demand-meta",
  "/api/internal/demand-meta-evidence",
  "/api/internal/demand-meta-diagnosis",
  "/api/internal/demand-meta-pilot",
  "/api/internal/demand-meta-campaigns",
]);


// Restrict the CONTENT exception to the two exact DEV routes. These endpoints
// enforce their own Preview-only feature flag, Neon Auth identity and tenant RLS;
// the BCI Supabase middleware must not redirect them to /login first.
const contentDevWorkspacePath = /^\/api\/content\/dev\/workspaces\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/campaign-drafts)?$/i;

export function usesNeonPreviewAuthentication(pathname: string): boolean {
  return neonPreviewPaths.has(pathname) || pathname==='/api/content/dev/workspaces' || contentDevWorkspacePath.test(pathname);
}
