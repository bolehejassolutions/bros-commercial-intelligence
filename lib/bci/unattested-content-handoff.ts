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
  // Narrow unknown input independently; TypeScript cannot preserve the guard
  // when it is interleaved with unrelated short-circuit scope checks.
  if (!exact(input, handoffKeys)) deny();
  // Explicitly retain the runtime-validated record type across strict TS
  // control-flow checks (no assertion before the shape check).
  const handoff = input as Record<string, unknown>;
  if (!exact(serverDerivedScope, ["tenantId", "product"]) ||
      typeof serverDerivedScope.tenantId !== "string" ||
      !UUID.test(serverDerivedScope.tenantId) ||
      serverDerivedScope.product !== "content" ||
      handoff.schemaVersion !== 1 || handoff.product !== "content" ||
      handoff.tenantId !== serverDerivedScope.tenantId ||
      handoff.category !== "content_post_observation" ||
      typeof handoff.evidenceId !== "string" || !SNAPSHOT.test(handoff.evidenceId) ||
      !exact(handoff.provenance, provenanceKeys) ||
      !exact(handoff.metrics, metricNames)) deny();
  const provenance = handoff.provenance as Record<string, unknown>;
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
  if (!Array.isArray(handoff.unknowns) || !Array.isArray(handoff.observedFacts)) deny();
  const unknowns = handoff.unknowns as unknown[];
  const observedFacts = handoff.observedFacts as unknown[];
  if (new Set(unknowns).size !== unknowns.length ||
      unknowns.some(flag => typeof flag !== "string" || !allowedUnknowns.has(flag)) ||
      requiredUnknowns.some(flag => !unknowns.includes(flag)) ||
      observedFacts.length !== 2 ||
      observedFacts.some(fact => typeof fact !== "string" || fact.length > 300)) deny();
  const metrics = handoff.metrics as Record<string, unknown>;
  if (metricNames.some(key => metrics[key] !== null &&
      (typeof metrics[key] !== "number" || !Number.isSafeInteger(metrics[key]) ||
       (metrics[key] as number) < 0))) deny();
  // CONTENT legitimately uses windowEnd=null for SENT_UNMEASURED. Never
  // accept that shape with measured counts, nor promote missing metrics to 0.
  // The optional flag and the provider metric window must agree exactly.
  const measured = metricNames.some(key => metrics[key] !== null);
  const unavailable = unknowns.includes("MEASUREMENT_UNAVAILABLE");
  if (measured === unavailable ||
      (provenance.windowEnd === null) !== !measured ||
      (!measured && provenance.observedAt !== provenance.windowStart)) deny();

  // Treat a CONTENT-shaped observation as an untrusted projection, NEVER
  // as provider_verified or a live outcome. Repeated collection of the same
  // snapshot retains the same key, but does not create a durable ledger row.
  const envelope = normalizeEvidenceEnvelope({
    tenantId: serverDerivedScope.tenantId,
    product: "content",
    provider: "buffer",
    providerRecordKey: handoff.evidenceId,
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
