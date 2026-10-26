/** Internal CONTENT publication evidence gate. This never publishes or attests providers. */
export type ContentEvidence = Readonly<{
  tenantId: string;
  product: "content";
  contentId: string;
  stage: "media_qa" | "approval" | "provider_sent" | "measurement";
  sourceKey: string;
  verified: boolean;
  at: string;
  /** Required for provider_sent; external provider's immutable post identifier. */
  providerPostId?: string;
}>;
export type ContentGate = Readonly<{
  mediaQa: boolean;
  approved: boolean;
  sent: boolean;
  measured: boolean;
  internalV1EvidenceComplete: boolean;
}>;
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (): never => { throw new Error("Invalid CONTENT evidence"); };
/** Verified flags are supplied ONLY by trusted server-side ingestion, never by the client. */
export function evaluateContentEvidence(tenantId: string, contentId: string, rows: readonly ContentEvidence[]): ContentGate {
  if (!id.test(tenantId) || !contentId || contentId.length > 160 || !Array.isArray(rows) || rows.length > 1000) fail();
  const seen = new Map<string, string>();
  const verified = new Map<ContentEvidence["stage"], ContentEvidence>();
  for (const row of rows) {
    if (!row || row.tenantId !== tenantId || row.product !== "content" ||
        row.contentId !== contentId || !["media_qa","approval","provider_sent","measurement"].includes(row.stage) ||
        typeof row.sourceKey !== "string" || !row.sourceKey.trim() ||
        typeof row.verified !== "boolean" || typeof row.at !== "string" ||
        !Number.isFinite(Date.parse(row.at)) ||
        (row.stage === "provider_sent"
          ? typeof row.providerPostId !== "string" || !row.providerPostId.trim()
          : row.providerPostId !== undefined)) fail();
    const key = row.stage + ":" + row.sourceKey;
    const fingerprint = JSON.stringify(row);
    if (seen.has(key)) {
      if (seen.get(key) !== fingerprint) fail();
      continue;
    }
    seen.set(key, fingerprint);
    if (row.verified) {
      if (verified.has(row.stage)) fail(); // ambiguous competing attestations
      verified.set(row.stage, row);
    }
  }
  const qa = verified.get("media_qa"), approval = verified.get("approval");
  const sent = verified.get("provider_sent"), measurement = verified.get("measurement");
  const ordered = (a?: ContentEvidence, b?: ContentEvidence) =>
    !a || !b || Date.parse(a.at) <= Date.parse(b.at);
  if (!ordered(qa, approval) || !ordered(approval, sent) || !ordered(sent, measurement)) fail();
  return Object.freeze({
    mediaQa: !!qa,
    approved: !!qa && !!approval,
    sent: !!qa && !!approval && !!sent,
    measured: !!qa && !!approval && !!sent && !!measurement,
    internalV1EvidenceComplete: !!qa && !!approval && !!sent && !!measurement,
  });
}
