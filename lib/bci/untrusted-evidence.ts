/** Untrusted ingestion is always reported, never verified. Provider verification
 * must occur in a separate server-side authenticated adapter, not in JSON input.
 */
import { normalizeEvidenceEnvelope, type EvidenceEnvelope } from "./evidence-envelope.ts";
export function normalizeUntrustedEvidence(input: unknown): EvidenceEnvelope {
  const parsed = normalizeEvidenceEnvelope(input);
  if (parsed.provenance === "provider_verified") {
    throw new Error("Untrusted evidence cannot assert provider verification");
  }
  return parsed;
}
