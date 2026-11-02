/** Exact paths protected by their own Preview-only Neon authentication boundary. */
const neonPreviewPaths = new Set([
  "/api/internal/neon-evidence",
  "/api/internal/neon-demand-case",
  "/api/internal/neon-lineage-receipt",
  "/api/internal/neon-demand-proposal",
  "/api/internal/neon-content-reservation",
  "/internal/neon-preview",
]);

export function usesNeonPreviewAuthentication(pathname: string): boolean {
  return neonPreviewPaths.has(pathname);
}

