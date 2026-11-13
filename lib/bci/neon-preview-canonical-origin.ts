/**
 * Canonical branch Preview origin already whitelisted by Neon Auth.
 *
 * Vercel immutable deployment URLs rotate on each commit and are NOT trusted
 * by Neon Auth. Redirect only the sign-in PAGE to the stable branch alias;
 * existing token/API routes retain their server-side JWT and RLS boundaries.
 * Never infer an authentication origin from caller-controlled headers.
 */
export const BCI_NEON_PREVIEW_CANONICAL_ORIGIN =
  "https://bros-commercial-intelligence-git-4a0d3f-bolehejassolutions-8492.vercel.app";
const canonicalHost = new URL(BCI_NEON_PREVIEW_CANONICAL_ORIGIN).host;
export const BCI_NEON_PREVIEW_CANONICAL_SIGNIN =
  BCI_NEON_PREVIEW_CANONICAL_ORIGIN + "/internal/neon-preview";

/** No credentials or user-supplied redirect destination accepted. */
export function neonPreviewCanonicalRedirect(host: unknown): string | null {
  if (typeof host === "string" && host === canonicalHost) return null;
  return BCI_NEON_PREVIEW_CANONICAL_SIGNIN;
}
