/**
 * BCI shared-core append planner for a FUTURE private audit writer.
 * Pure structural/idempotency validation only: no SQL, auth, provider
 * attestation, durable write or evidence of a business outcome.
 *
 * Untrusted CONTENT/DEMAND submissions may only introduce UNVERIFIED
 * records. A server-owned provider adapter must separately authenticate
 * and attest evidence before a later trusted persistence integration.
 */
import {
  validateBciLineage,
  type BciLineageRecord,
  type BciLineageScope,
  type BciLineageStage,
} from "./internal-lineage.ts";

export type BciUntrustedAuditAppendPlan = Readonly<{
  scope: BciLineageScope;
  /** FK-safe stage ordering; caller must still use an authenticated transaction. */
  toInsert: readonly BciLineageRecord[];
  /** Already stored, byte-equivalent logical records; do not insert again. */
  replayedIds: readonly string[];
  /** Structural ancestry only, NEVER verified learning or causal impact. */
  structurallyLinkedLearnings: number;
  authenticated: false;
  providerAttested: false;
  persisted: false;
}>;

const keys = new Set([
  "id", "tenantId", "product", "stage", "sourceSystem",
  "sourceRecordKey", "recordedAt", "parentIds", "verification",
]);
const stages: readonly BciLineageStage[] = [
  "evidence", "signal", "case", "diagnosis", "decision", "action", "outcome", "learning",
];
const deny = (): never => { throw new Error("Invalid BCI audit append"); };
const exactShape = (value: unknown): value is BciLineageRecord => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.size &&
    ownKeys.every(key => {
      if (typeof key !== "string" || !keys.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor && descriptor.enumerable === true &&
        Object.prototype.hasOwnProperty.call(descriptor, "value");
    });
};

/**
 * Plan an append without rewriting history or promoting caller assertions.
 * Stable IDs and stage/source keys are validated by the existing BCI lineage
 * contract. A changed snapshot MUST have a new versioned sourceRecordKey.
 */
export function planUntrustedBciAuditAppend(
  scope: BciLineageScope,
  persisted: readonly BciLineageRecord[],
  incoming: readonly BciLineageRecord[],
): BciUntrustedAuditAppendPlan {
  if (!Array.isArray(persisted) || !Array.isArray(incoming) ||
      persisted.length + incoming.length > 1000 ||
      !persisted.every(exactShape) || !incoming.every(exactShape) ||
      incoming.some(record => record.verification !== "unverified")) deny();

  const historical = validateBciLineage(scope, persisted);
  // Duplicate rows in a supposedly authoritative stored snapshot indicate
  // an integrity problem, even when their logical content is identical.
  if (historical.records.length !== persisted.length) deny();
  const combined = validateBciLineage(scope, [...persisted, ...incoming]);
  const storedIds = new Set(historical.records.map(record => record.id));
  const toInsert = combined.records
    .filter(record => !storedIds.has(record.id))
    .sort((a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage) ||
      a.id.localeCompare(b.id));
  const replayedIds = [...new Set(incoming
    .filter(record => storedIds.has(record.id))
    .map(record => record.id))].sort();

  return Object.freeze({
    scope: Object.freeze({ ...combined.scope }),
    toInsert: Object.freeze(toInsert),
    replayedIds: Object.freeze(replayedIds),
    structurallyLinkedLearnings: combined.structurallyLinkedLearnings,
    authenticated: false,
    providerAttested: false,
    persisted: false,
  });
}
