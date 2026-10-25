import "server-only";
import {
  createPrivateEvidenceReader,
  PrivateEvidenceAccessDenied,
  type PrivateEvidenceDependencies,
} from "@/lib/bci/private-evidence-boundary";

/**
 * SERVER-ONLY, preview-only composition point.
 *
 * No app credentials, Neon driver, or public API route is wired in this PR.
 * Before calling this, the server must implement:
 *  - a verified authentication provider,
 *  - authoritative tenant membership (not a caller-supplied tenantId),
 *  - a least-privileged non-BYPASSRLS database login and parameterized query.
 *
 * Existing BCI Supabase operator membership proves INTERNAL BCI operator access
 * only; it does not independently grant any customer tenant membership.
 */
export function createPreviewPrivateEvidenceReader(deps: PrivateEvidenceDependencies) {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.BCI_NEON_DEV_PRIVATE_READS !== "enabled") {
    throw new PrivateEvidenceAccessDenied(
      "Private Neon BCI evidence reader is disabled outside an explicitly enabled preview."
    );
  }
  return createPrivateEvidenceReader(deps);
}
