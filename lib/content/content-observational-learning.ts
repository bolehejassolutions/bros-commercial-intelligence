/**
 * INTERNAL BROS CONTENT — read-only publication-to-learning projection.
 * Input must come from an authorized, trusted Buffer read adapter plus independent
 * source QA/approval. No publishing, network I/O, attribution or customer access.
 * Provider counts are observations, never verified leads, revenue or causality.
 */
import type { PublicationEvidence, ContentChannel } from "./buffer-publication-evidence.ts";

export type ContentObservationInput = Readonly<{
  tenantId: string;
  product: "content";
  observedAt: string;
  publication: PublicationEvidence;
}>;
export type ContentObservation = Readonly<{
  /** Stable idempotency key for one provider post/metric snapshot within a tenant. */
  sourceKey: string;
  tenantId: string;
  product: "content";
  provider: "buffer";
  postId: string;
  channel: ContentChannel;
  sentAt: string;
  metricsUpdatedAt: string;
  observedAt: string;
  metrics: Readonly<Record<string, number>>;
  sourceHashes: readonly string[];
  providerMediaBytesVerified: false;
  verification: "provider_reported";
  causalEffect: null;
  qualifiedLeads: null;
  attributedSales: null;
  /** No cross-channel metric aggregation or fabricated conversion rates. */
  learning: "observational_measurement_only";
  nextBestAction: "collect_qualified_visit_evidence";
  warnings: readonly string[];
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA = /^[a-f0-9]{64}$/;
const POST = /^[a-f0-9]{24}$/;
const deny = (): never => { throw new Error("Invalid CONTENT observational evidence"); };
const isTime = (v: unknown): v is string => typeof v === "string" && ISO.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Idempotent projection of verified-in-context, provider-reported SENT measurements. */
export function projectContentObservations(inputs: readonly ContentObservationInput[]): readonly ContentObservation[] {
  if (!Array.isArray(inputs) || inputs.length > 1000) deny();
  const unique = new Map<string, { fingerprint: string; observation: ContentObservation }>();
  const postScope = new Map<string, string>();
  for (const input of inputs) {
    if (!input || !UUID.test(input.tenantId) || input.product !== "content" ||
        !isTime(input.observedAt) || !obj(input.publication)) deny();
    const p = input.publication;
    const sentAt = p.providerSentAt;
    const metricsUpdatedAt = p.metricsUpdatedAt;
    const reportedMetrics = p.metrics;
    if (p.provider !== "buffer" || !POST.test(p.postId) ||
        !["facebook", "instagram", "tiktok"].includes(p.channel) ||
        p.providerStatus !== "sent" || !isTime(sentAt) ||
        !isTime(metricsUpdatedAt) || !obj(reportedMetrics) ||
        p.sourceFullDecodeVerified !== true || p.sourceEditorialApproved !== true ||
        p.readyForObservationalLearning !== true || p.providerMediaBytesVerified !== false ||
        p.attribution !== "provider_observation_only" ||
        !Array.isArray(p.mediaSourceHashes) || p.mediaSourceHashes.length === 0 ||
        p.mediaSourceHashes.length > 10 || p.mediaSourceHashes.some(h => typeof h !== "string" || !SHA.test(h)) ||
        !Array.isArray(p.warnings) || p.warnings.some(w => w !== "asset_mime_mismatch") ||
        Date.parse(metricsUpdatedAt) < Date.parse(sentAt) ||
        Date.parse(input.observedAt) < Date.parse(metricsUpdatedAt)) deny();
    if (!isTime(sentAt) || !isTime(metricsUpdatedAt) || !obj(reportedMetrics)) deny();
    const verifiedSentAt = sentAt as string;
    const verifiedMetricsUpdatedAt = metricsUpdatedAt as string;
    const verifiedMetrics = reportedMetrics as Readonly<Record<string, number>>;
    const metrics: Record<string, number> = Object.create(null) as Record<string, number>;
    const keys = Object.keys(verifiedMetrics);
    if (!keys.length || keys.length > 50) deny();
    for (const key of keys.sort()) {
      const value = verifiedMetrics[key];
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(key) ||
          typeof value !== "number" || !Number.isFinite(value) || value < 0) deny();
      metrics[key] = value;
    }
    const postKey = `${input.tenantId}:content:buffer:${p.postId}`;
    const priorChannel = postScope.get(postKey);
    if (priorChannel && priorChannel !== p.channel) deny();
    postScope.set(postKey, p.channel);
    const sourceKey = `${postKey}:${verifiedMetricsUpdatedAt}`;
    const hashes = Object.freeze([...p.mediaSourceHashes]);
    const warnings = Object.freeze([...p.warnings]);
    const fingerprint = JSON.stringify([p.channel, verifiedSentAt, metrics, hashes, warnings]);
    const prior = unique.get(sourceKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) deny();
      continue; // duplicate provider snapshot, never double-count it
    }
    const observation: ContentObservation = Object.freeze({
      sourceKey, tenantId: input.tenantId, product: "content" as const,
      provider: "buffer" as const, postId: p.postId, channel: p.channel,
      sentAt: verifiedSentAt, metricsUpdatedAt: verifiedMetricsUpdatedAt,
      observedAt: input.observedAt, metrics: Object.freeze(metrics),
      sourceHashes: hashes, providerMediaBytesVerified: false as const,
      verification: "provider_reported" as const, causalEffect: null,
      qualifiedLeads: null, attributedSales: null,
      learning: "observational_measurement_only" as const,
      nextBestAction: "collect_qualified_visit_evidence" as const,
      warnings,
    });
    unique.set(sourceKey, { fingerprint, observation });
  }
  return Object.freeze([...unique.values()].map(v => v.observation).sort((a, b) =>
    a.sourceKey.localeCompare(b.sourceKey)));
}
