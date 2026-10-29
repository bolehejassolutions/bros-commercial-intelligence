import { createHash } from "node:crypto";
import type { DemandCampaignInventory } from "./meta-campaign-execution-evidence.ts";

/**
 * DEMAND-only Meta dataset inventory observation. A provider-reported
 * last_fired_time says a dataset received some activity, NOT which event,
 * whether it was a test, a paid order, a particular campaign, or a conversion.
 * Connector access is NOT independently authenticated BCI tenant access.
 */
const fail = (): never => { throw new Error("Invalid DEMAND Meta dataset inventory"); };
const ID = /^[0-9]+$/;
const ACCOUNT = /^act_[0-9]+$/;
const META_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{4})$/;

function parseMetaTime(value: unknown): string {
  if (typeof value !== "string") fail();
  const m = META_TIME.exec(value as string);
  if (!m) fail();
  const [, year, month, day, hour, minute, second, offset] = m!;
  const y = Number(year), mo = Number(month), d = Number(day);
  const h = Number(hour), mi = Number(minute), s = Number(second);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== mo ||
      date.getUTCDate() !== d || date.getUTCHours() !== h ||
      date.getUTCMinutes() !== mi || date.getUTCSeconds() !== s) fail();
  let offsetMinutes = 0;
  if (offset !== "Z") {
    const oh = Number(offset.slice(1, 3)), om = Number(offset.slice(3, 5));
    if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) fail();
    offsetMinutes = (offset[0] === "+" ? 1 : -1) * (oh * 60 + om);
  }
  return new Date(date.getTime() - offsetMinutes * 60_000).toISOString();
}

export function assessDemandMetaDatasetActivity(
  accountId: string,
  datasetId: string,
  inventory: DemandCampaignInventory,
) {
  if (typeof accountId !== "string" || !ACCOUNT.test(accountId) ||
      typeof datasetId !== "string" || !ID.test(datasetId) ||
      !inventory || !Array.isArray(inventory.rows) || inventory.rows.length > 500 ||
      inventory.nextPageToken !== null || inventory.missingScopes !== null ||
      (inventory.droppedFields != null &&
        (!Array.isArray(inventory.droppedFields) || inventory.droppedFields.length > 0))) fail();

  const seen = new Set<string>();
  let target: { unavailable: boolean; createdAt: string; lastFiredAt: string | null } | null = null;
  for (const row of inventory.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        typeof row.id !== "string" || !ID.test(row.id) || seen.has(row.id) ||
        typeof row.is_unavailable !== "boolean") fail();
    seen.add(row.id as string);
    const createdAt = parseMetaTime(row.creation_time);
    const lastFiredAt = row.last_fired_time === null || row.last_fired_time === undefined
      ? null : parseMetaTime(row.last_fired_time);
    if (lastFiredAt !== null && lastFiredAt < createdAt) fail();
    if (row.id === datasetId) {
      target = { unavailable: row.is_unavailable as boolean, createdAt, lastFiredAt };
    }
  }

  const state = target === null ? "DATASET_NOT_IN_COMPLETE_INVENTORY" :
    target.unavailable ? "DATASET_UNAVAILABLE_AT_READBACK" :
    target.lastFiredAt === null ? "NO_ACTIVITY_TIMESTAMP_RETURNED" :
    "ACTIVITY_TIMESTAMP_REPORTED_EVENT_UNVERIFIED";
  const snapshotKey = "demand:meta-dataset-activity:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1", accountId, datasetId, state,
      target?.createdAt ?? null, target?.lastFiredAt ?? null,
      target?.unavailable ?? null])).digest("hex");
  return Object.freeze({
    snapshotKey, state,
    datasetCreationTimeUtc: target?.createdAt ?? null,
    lastDatasetActivityTimeUtc: target?.lastFiredAt ?? null,
    datasetAvailableAtReadback: target === null ? null : !target.unavailable,
    nextBestEvidenceAction: target === null
      ? "VERIFY_DATASET_ACCOUNT_SELECTION" as const :
      "OBTAIN_EVENT_TYPE_ENVIRONMENT_AND_CAMPAIGN_BOUND_RECEIPTS" as const,
    // These are intentionally not derived from a last_fired_time.
    datasetActivityEventType: null,
    testEventCount: null,
    livePurchaseEventCount: null,
    campaignDatasetLinkVerified: false as const,
    providerAuthenticationVerifiedForDemandApp: false as const,
    tenantAuthorizationVerifiedForDemandApp: false as const,
    metaEventToHitPayOrderJoinVerified: false as const,
    verifiedSettledOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    verifiedAcquisitionOutcome: null,
    durableBciLearningVerified: false as const,
  });
}
