/**
 * Internal-only, deterministic provenance graph for shared BCI reasoning.
 * No auth, database, provider attestation, external API or action execution.
 * A structurally valid graph is NOT proof that a provider event happened.
 */
export type BciLineageProduct = "content" | "demand";
export type BciLineageStage =
  | "evidence" | "signal" | "case" | "diagnosis"
  | "decision" | "action" | "outcome" | "learning";
export type BciLineageVerification = "unverified" | "provider_reported" | "verified";
export type BciLineageRecord = Readonly<{
  id: string;
  tenantId: string;
  product: BciLineageProduct;
  stage: BciLineageStage;
  sourceSystem: string;
  sourceRecordKey: string;
  recordedAt: string;
  /** IDs of preceding-stage records; empty only for root evidence. */
  parentIds: readonly string[];
  /** Verification is provenance metadata, not a self-attesting security assertion. */
  verification: BciLineageVerification;
}>;
export type BciLineageScope = Readonly<{ tenantId: string; product: BciLineageProduct }>;
export type BciLineageResult = Readonly<{
  scope: BciLineageScope;
  records: readonly BciLineageRecord[];
  counts: Readonly<Record<BciLineageStage, number>>;
  /** Number of learning nodes with an intact structural ancestry, not verified outcomes. */
  structurallyLinkedLearnings: number;
}>;
const stages: readonly BciLineageStage[] = [
  "evidence", "signal", "case", "diagnosis", "decision", "action", "outcome", "learning",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const scopeFields = new Set(["tenantId", "product"]);
const recordFields = new Set([
  "id", "tenantId", "product", "stage", "sourceSystem",
  "sourceRecordKey", "recordedAt", "parentIds", "verification",
]);
const exactFields = (value: object, fields: ReadonlySet<string>): boolean => {
  // Object.keys ignores symbol and non-enumerable own keys; object spread
  // can otherwise reflect unreviewed symbol metadata into the result.
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.size &&
    keys.every(key => {
      if (typeof key !== "string" || !fields.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // Reject accessor and hidden properties before any caller-controlled getter
      // can run or be copied into a shared audit result.
      return !!descriptor && descriptor.enumerable === true &&
        Object.prototype.hasOwnProperty.call(descriptor, "value");
    });
};
const deny = (): never => { throw new Error("Invalid BCI evidence lineage"); };
const validTime = (x: unknown): x is string =>
  typeof x === "string" && UTC.test(x) && Number.isFinite(Date.parse(x)) &&
  new Date(x).toISOString().slice(0, 19) === x.slice(0, 19);
const validLabel = (x: unknown): x is string =>
  typeof x === "string" && x.length > 0 && x.length <= 160 && x.trim() === x;

/**
 * Reject mixed tenant/product, orphans, invalid stage links and conflicting replays.
 * No provider mutation and no inference that an action caused an outcome.
 */
export function validateBciLineage(
  scope: BciLineageScope,
  records: readonly BciLineageRecord[],
): BciLineageResult {
  if (!scope || typeof scope !== "object" || Array.isArray(scope) ||
      !exactFields(scope, scopeFields) ||
      typeof scope.tenantId !== "string" || !UUID.test(scope.tenantId) ||
      (scope.product !== "content" && scope.product !== "demand") ||
      !Array.isArray(records) || records.length > 1000) deny();
  const byId = new Map<string, BciLineageRecord>();
  const bySource = new Map<string, string>();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record) ||
        !exactFields(record, recordFields) ||
        typeof record.id !== "string" || !UUID.test(record.id) ||
        typeof record.tenantId !== "string" || record.tenantId !== scope.tenantId ||
        record.product !== scope.product || !stages.includes(record.stage) ||
        !validLabel(record.sourceSystem) || !validLabel(record.sourceRecordKey) ||
        !validTime(record.recordedAt) || !Array.isArray(record.parentIds) ||
        record.parentIds.length > 100 ||
        !["unverified", "provider_reported", "verified"].includes(record.verification) ||
        (record.stage === "evidence" ? record.parentIds.length !== 0 : record.parentIds.length === 0) ||
        record.parentIds.some(p => typeof p !== "string" || !UUID.test(p)) ||
        new Set(record.parentIds).size !== record.parentIds.length) deny();
    const fingerprint = JSON.stringify([
      record.tenantId, record.product, record.stage, record.sourceSystem,
      record.sourceRecordKey, record.recordedAt, record.parentIds.slice().sort(), record.verification,
    ]);
    const prior = byId.get(record.id);
    if (prior) {
      const priorFingerprint = JSON.stringify([
        prior.tenantId, prior.product, prior.stage, prior.sourceSystem,
        prior.sourceRecordKey, prior.recordedAt, prior.parentIds.slice().sort(), prior.verification,
      ]);
      if (fingerprint !== priorFingerprint) deny();
      continue;
    }
    const sourceKey = JSON.stringify([record.stage, record.sourceSystem, record.sourceRecordKey]);
    const priorId = bySource.get(sourceKey);
    if (priorId && priorId !== record.id) deny();
    bySource.set(sourceKey, record.id);
    byId.set(record.id, record);
  }
  const counts = Object.fromEntries(stages.map(s => [s, 0])) as Record<BciLineageStage, number>;
  for (const record of byId.values()) {
    counts[record.stage]++;
    const position = stages.indexOf(record.stage);
    for (const parentId of record.parentIds) {
      const parent = byId.get(parentId);
      if (!parent || stages.indexOf(parent.stage) !== position - 1 ||
          Date.parse(parent.recordedAt) > Date.parse(record.recordedAt)) deny();
    }
  }
  // Every learning record has a full chain by construction, but this is only
  // structural lineage. Never infer actual publishing, payment or causality.
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    records: Object.freeze([...byId.values()].map(r => Object.freeze({
      ...r, parentIds: Object.freeze([...r.parentIds]),
    }))),
    counts: Object.freeze(counts),
    structurallyLinkedLearnings: counts.learning,
  });
}
