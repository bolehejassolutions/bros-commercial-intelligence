/**
 * Pure client-side status helper for the manually initiated DEMAND read-only check.
 * Returns only fixed human-readable phase categories, never an error object,
 * token, email, identity claim, connection string or provider response.
 */
export type DemandMetaBrowserPhase = "session" | "token" | "request" | "headers" | "payload";
export type DemandMetaTokenFailure = "provider" | "response" | "exception" | null;

const fixed = Object.freeze({
  session: "Browser check stopped at Neon Auth session validation. Sign in again using the app; no server read was attempted.",
  request: "Browser check stopped while sending the authorized request. No server read is confirmed.",
  headers: "Browser check received a response, but mandatory security headers could not be verified.",
  payload: "Browser check received a response, but expected read-only response fields could not be verified.",
} as const);

export function demandMetaBrowserDiagnostic(
  phase: DemandMetaBrowserPhase,
  tokenFailure: DemandMetaTokenFailure = null,
): string {
  if (phase === "token") {
    if (tokenFailure === "provider") return "Neon Auth token request was rejected by the provider; no authorized DEMAND API request was sent.";
    if (tokenFailure === "response") return "Neon Auth token endpoint returned no usable signed token; no authorized DEMAND API request was sent.";
    return "Browser check could not obtain a Neon Auth token; no authorized DEMAND API request is confirmed.";
  }
  if (phase === "session" || phase === "request" || phase === "headers" || phase === "payload") return fixed[phase];
  return "Browser check could not be verified. No success was recorded.";
}
