/**
 * INTERNAL BROS CONTENT — deterministic reconciliation of an already-published
 * Buffer post with independently supplied source QA and approval evidence.
 * READ-ONLY. No provider API calls, publication actions, or customer access.
 *
 * Buffer status/metrics are provider-reported, not independently verified
 * platform delivery. Source container checks are not full media decoding.
 * The caller must independently authenticate, authorize and verify approval,
 * source bytes and the Buffer response before using this contract.
 */
import type { SourceImageAttestation } from "./source-image-attestation.ts";

export type ContentChannel = "facebook" | "instagram" | "tiktok";
export type SourceReview = Readonly<{
  attestation: SourceImageAttestation;
  /** Independently evidenced full decode, not implied by the attestation. */
  fullDecodeVerified: boolean;
  /** Independently evidenced editorial approval for this exact SHA256. */
  approved: boolean;
}>;
export type PublicationReviewInput = Readonly<{
  expectedPostId: string;
  expectedChannel: ContentChannel;
  sourceReviews: readonly SourceReview[];
  /** Provider snapshot supplied by a trusted read-only Buffer adapter. */
  bufferPost: unknown;
}>;
export type PublicationWarning =
  | "not_sent" | "invalid_sent_timestamp" | "missing_source_qa"
  | "source_not_fully_decoded" | "source_not_approved"
  | "asset_count_mismatch" | "asset_dimensions_mismatch"
  | "asset_mime_mismatch" | "ai_disclosure_mismatch"
  | "metrics_unavailable";
export type PublicationEvidence = Readonly<{
  postId: string;
  channel: ContentChannel;
  provider: "buffer";
  providerStatus: "sent" | "not_sent";
  providerSentAt: string | null;
  externalLink: string | null;
  mediaSourceHashes: readonly string[];
  sourceFullDecodeVerified: boolean;
  sourceEditorialApproved: boolean;
  /** Never claims Buffer-served bytes match Drive/source bytes. */
  providerMediaBytesVerified: false;
  metricsUpdatedAt: string | null;
  /** Channel-specific raw counts; no cross-platform sum or lead inference. */
  metrics: Readonly<Record<string, number>> | null;
  warnings: readonly PublicationWarning[];
  readyForObservationalLearning: boolean;
  attribution: "provider_observation_only";
}>;

const ID = /^[a-f0-9]{24}$/;
const SHA = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const isTime = (v: unknown): v is string => typeof v === "string" && ISO.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const deny = (): never => { throw new Error("Invalid CONTENT Buffer publication evidence"); };
const push = (arr: PublicationWarning[], w: PublicationWarning) => { if (!arr.includes(w)) arr.push(w); };

export function reconcileBufferPublication(input: PublicationReviewInput): PublicationEvidence {
  if (!input || typeof input.expectedPostId !== "string" || !ID.test(input.expectedPostId) ||
      !["facebook", "instagram", "tiktok"].includes(input.expectedChannel) ||
      !Array.isArray(input.sourceReviews) || input.sourceReviews.length > 10 ||
      !record(input.bufferPost)) deny();
  const post = input.bufferPost;
  if (!record(post)) throw new Error("Invalid CONTENT Buffer publication evidence");
  if (post.id !== input.expectedPostId || post.channelService !== input.expectedChannel ||
      typeof post.status !== "string" || !Array.isArray(post.assets) ||
      post.assets.length > 10) throw new Error("Invalid CONTENT Buffer publication evidence");
  const warnings: PublicationWarning[] = [];
  const sent = post.status === "sent";
  if (!sent) push(warnings, "not_sent");
  const sentAt = sent && isTime(post.sentAt) ? post.sentAt : null;
  if (sent && sentAt === null) push(warnings, "invalid_sent_timestamp");
  const reviews = input.sourceReviews;
  if (!reviews.length) push(warnings, "missing_source_qa");
  let allDecoded = reviews.length > 0;
  let allApproved = reviews.length > 0;
  for (const review of reviews) {
    if (!record(review) || !record(review.attestation) ||
        !SHA.test(review.attestation.sha256) ||
        !["image/png", "image/jpeg"].includes(review.attestation.detectedMime) ||
        !Number.isSafeInteger(review.attestation.width) ||
        !Number.isSafeInteger(review.attestation.height) ||
        review.attestation.verification !== "source_container_only" ||
        review.attestation.publishedBytesVerified !== false ||
        typeof review.fullDecodeVerified !== "boolean" || typeof review.approved !== "boolean") deny();
    if (!review.fullDecodeVerified) { allDecoded = false; push(warnings, "source_not_fully_decoded"); }
    if (!review.approved) { allApproved = false; push(warnings, "source_not_approved"); }
  }
  if (reviews.length !== post.assets.length) push(warnings, "asset_count_mismatch");
  for (let i = 0; i < Math.min(reviews.length, post.assets.length); i++) {
    const asset = post.assets[i];
    if (!record(asset) || !record(asset.image)) deny();
    const a = reviews[i]!.attestation;
    if (asset.image.width !== a.width || asset.image.height !== a.height)
      push(warnings, "asset_dimensions_mismatch");
    if (typeof asset.mimeType !== "string" || asset.mimeType.toLowerCase() !== a.detectedMime)
      push(warnings, "asset_mime_mismatch");
  }
  // Only flag explicit contradiction, not absent/unsupported metadata.
  if (input.expectedChannel === "tiktok" || input.expectedChannel === "instagram") {
    const meta = post.metadata;
    const caption = post.text;
    if (record(meta) && typeof meta.isAiGenerated === "boolean" &&
        typeof caption === "string" && /(?:ilustrasi|gambar|imej)\s+AI\b/i.test(caption) &&
        meta.isAiGenerated === false) push(warnings, "ai_disclosure_mismatch");
  }
  let metrics: Record<string, number> | null = null;
  let metricsUpdatedAt: string | null = null;
  if (Array.isArray(post.metrics) && isTime(post.metricsUpdatedAt)) {
    metrics = Object.create(null) as Record<string, number>;
    for (const item of post.metrics) {
      if (!record(item) || typeof item.type !== "string" || !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(item.type) ||
          typeof item.value !== "number" || !Number.isFinite(item.value) || item.value < 0 ||
          Object.prototype.hasOwnProperty.call(metrics, item.type)) deny();
      metrics[item.type] = item.value;
    }
    metricsUpdatedAt = post.metricsUpdatedAt;
    if (Object.keys(metrics).length === 0) metrics = null;
  }
  if (!metrics) push(warnings, "metrics_unavailable");
  const hashes = Object.freeze(reviews.map(r => r.attestation.sha256));
  const ready = sent && sentAt !== null && allDecoded && allApproved && metrics !== null &&
    !warnings.some(w => w !== "asset_mime_mismatch");
  return Object.freeze({
    postId: input.expectedPostId, channel: input.expectedChannel, provider: "buffer" as const,
    providerStatus: sent ? "sent" as const : "not_sent" as const,
    providerSentAt: sentAt,
    externalLink: typeof post.externalLink === "string" && /^https:\/\//.test(post.externalLink)
      ? post.externalLink : null,
    mediaSourceHashes: hashes, sourceFullDecodeVerified: allDecoded,
    sourceEditorialApproved: allApproved, providerMediaBytesVerified: false as const,
    metricsUpdatedAt, metrics: metrics ? Object.freeze(metrics) : null,
    warnings: Object.freeze(warnings), readyForObservationalLearning: ready,
    attribution: "provider_observation_only" as const,
  });
}
