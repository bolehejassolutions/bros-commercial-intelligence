/**
 * BCI-owned boundary for CONTENT's UNATTESTED Buffer observation handoff.
 * The scope must come from a separately authenticated server membership;
 * this pure mapper cannot authenticate either that scope or the provider.
 * No persistence, provider write, publishing, approval or verification.
 */
import { normalizeEvidenceEnvelope } from "./evidence-envelope.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNAPSHOT = /^content-buffer-[0-9a-f]{64}$/;
const metricNames = [
  "impressions", "reach", "views", "reactions", "comments",
  "shares", "clicks", "saves", "follows",
] as const;
const handoffKeys = [
  "schemaVersion", "tenantId", "product", "evidenceId", "category",
  "provenance", "metrics", "observedFacts", "unknowns",
];
const provenanceKeys = [
  "provider", "providerObjectId", "collectedAt", "observedAt",
  "windowStart", "windowEnd", "sourceReference", "completeness",
];
const requiredUnknowns = [
  "PROVIDER_AUTHENTICATION_UNVERIFIED",
  "PUBLICATION_APPROVAL_UNVERIFIED",
  "NATIVE_MEDIA_BYTES_UNVERIFIED",
  "SHARED_BCI_AUDIT_NOT_WRITTEN",
];
const allowedUnknowns = new Set([...requiredUnknowns, "MEASUREMENT_UNAVAILABLE"]);
const deny = (): never => { throw new Error("Invalid unattested CONTENT handoff"); };
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  obj(v) && Object.keys(v).length === keys.length &&
  Object.keys(v).every(key => keys.includes(key));
const timestamp = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);

export function projectUnattestedContentHandoff(
  input: unknown,
  serverDerivedScope: Readonly<{ tenantId: string; product: "content" }>,
) {
  if (!exact(serverDerivedScope, ["tenantId", "product"]) ||
      typeof serverDerivedScope.tenantId !== "string" ||
      !UUID.test(serverDerivedScope.tenantId) ||
      serverDerivedScope.product !== "content" ||
      !exact(input, handoffKeys) ||
      input.schemaVersion !== 1 || input.product !== "content" ||
      input.tenantId !== serverDerivedScope.tenantId ||
      input.category !== "content_post_observation" ||
      typeof input.evidenceId !== "string" || !SNAPSHOT.test(input.evidenceId) ||
      !exact(input.provenance, provenanceKeys) ||
      !exact(input.metrics, metricNames)) deny();
  const provenance = input.provenance as Record<string, unknown>;
  if (provenance.provider !== "buffer" ||
      provenance.completeness !== "unverified" ||
      typeof provenance.providerObjectId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.|:-]{1,127}$/.test(provenance.providerObjectId) ||
      !timestamp(provenance.collectedAt) ||
      !timestamp(provenance.observedAt) ||
      !timestamp(provenance.windowStart) ||
      (provenance.windowEnd !== null && !timestamp(provenance.windowEnd)) ||
      Date.parse(provenance.windowStart) > Date.parse(provenance.observedAt) ||
      Date.parse(provenance.observedAt) > Date.parse(provenance.collectedAt) ||
      (provenance.windowEnd !== null && provenance.windowEnd !== provenance.observedAt) ||
      typeof provenance.sourceReference !== "string") deny();
  try {
    const link = new URL(provenance.sourceReference as string);
    if (link.protocol !== "https:" || link.username || link.password || link.port ||
        link.search || link.hash ||
        !["instagram.com", "www.instagram.com", "facebook.com", "www.facebook.com",
          "tiktok.com", "www.tiktok.com"].includes(link.hostname) ||
        link.pathname === "/") deny();
  } catch { deny(); }
  if (!Array.isArray(input.unknowns) ||
      new Set(input.unknowns).size !== input.unknowns.length ||
      input.unknowns.some(flag => typeof flag !== "string" || !allowedUnknowns.has(flag)) ||
      requiredUnknowns.some(flag => !input.unknowns.includes(flag)) ||
      !Array.isArray(input.observedFacts) || input.observedFacts.length !== 2 ||
      input.observedFacts.some(fact => typeof fact !== "string" || fact.length > 300)) deny();
  const metrics = input.metrics as Record<string, unknown>;
  if (metricNames.some(key => metrics[key] !== null &&
      (typeof metrics[key] !== "number" || !Number.isSafeInteger(metrics[key]) ||
       (metrics[key] as number) < 0))) deny();

  // Treat a CONTENT-shaped observation as an untrusted projection, NEVER
  // as provider_verified or a live outcome. Repeated collection of the same
  // snapshot retains the same key, but does not create a durable ledger row.
  const envelope = normalizeEvidenceEnvelope({
    tenantId: serverDerivedScope.tenantId,
    product: "content",
    provider: "buffer",
    providerRecordKey: input.evidenceId,
    observedAt: provenance.observedAt,
    environment: "unknown",
    provenance: "synthetic",
    metrics,
  });
  return Object.freeze({
    envelope,
    authenticated: false as const,
    providerAttested: false as const,
    approvalVerified: false as const,
    persisted: false as const,
  });
}
