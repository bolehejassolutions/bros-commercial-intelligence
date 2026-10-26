/** Conservative projection of external evidence. Never treats caller claims as attestation. */
import { normalizeUntrustedEvidence } from "./untrusted-evidence.ts";
import type { EvidenceEnvelope } from "./evidence-envelope.ts";
export type UntrustedEvidenceSummary = Readonly<{
  accepted: number;
  synthetic: number;
  providerReported: number;
  providerVerified: 0;
  readyForAttestation: false;
}>;
export function summarizeUntrustedEvidence(inputs: readonly unknown[]): UntrustedEvidenceSummary {
  if (!Array.isArray(inputs) || inputs.length > 1000) throw new Error("Invalid evidence batch");
  let synthetic = 0, providerReported = 0;
  const seen = new Set<string>();
  for (const input of inputs) {
    const row: EvidenceEnvelope = normalizeUntrustedEvidence(input);
    const key = [row.tenantId,row.product,row.provider,row.providerRecordKey].join(":");
    if (seen.has(key)) throw new Error("Duplicate evidence identity");
    seen.add(key);
    if (row.provenance === "synthetic") synthetic++;
    else providerReported++;
  }
  return Object.freeze({accepted:seen.size,synthetic,providerReported,providerVerified:0,readyForAttestation:false});
}
