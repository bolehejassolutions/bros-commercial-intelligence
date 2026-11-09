import { prepareDemandCreativeIntake } from "./creative-intake.ts";

/**
 * Server-only CONTENT -> DEMAND creative admission.
 * All dependencies must be bound to trusted authentication, membership and
 * immutable tenant-scoped storage adapters. No HTTP route or Meta write here.
 */
type Principal = Readonly<{ userId: string; authenticated: true }>;
type Grant = Readonly<{ principalId: string; tenantId: string; product: "demand"; active: true }>;
type Creative = Parameters<typeof prepareDemandCreativeIntake>[1];
type Dependencies = Readonly<{
  authenticate: () => Promise<Principal | null>;
  membershipsFor: (userId: string) => Promise<readonly Grant[]>;
  /** Must return immutable approved metadata from authorized CONTENT storage. */
  approvedRecordFor: (tenantId: string, assetId: string, version: string) => Promise<Creative | null>;
  /** Must retrieve real bytes for the exact immutable asset/version, never a URL from client input. */
  mediaFor: (tenantId: string, assetId: string, version: string) => Promise<Uint8Array | null>;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,127}$/;
const deny = (): never => { throw new Error("BROS_DEMAND_CREATIVE_ADMISSION_DENIED"); };
function tenant(grants: readonly Grant[], userId: string): string {
  if (!Array.isArray(grants) || grants.length !== 1) deny();
  const grant = grants[0];
  if (!grant || grant.active !== true || grant.product !== "demand" ||
      grant.principalId !== userId || !UUID.test(grant.tenantId)) deny();
  return grant.tenantId.toLowerCase();
}
export function createDemandCreativeAdmission(deps: Dependencies) {
  if (!deps || typeof deps.authenticate !== "function" ||
      typeof deps.membershipsFor !== "function" ||
      typeof deps.approvedRecordFor !== "function" ||
      typeof deps.mediaFor !== "function") deny();
  return async (request: Readonly<{ assetId: string; creativeVersion: string }>) => {
    try {
      if (!request || typeof request !== "object" || Array.isArray(request) ||
          Object.keys(request).length !== 2 ||
          !Object.hasOwn(request, "assetId") ||
          !Object.hasOwn(request, "creativeVersion") ||
          !ID.test(request.assetId) || !ID.test(request.creativeVersion)) deny();
      const principal = await deps.authenticate();
      if (!principal || principal.authenticated !== true ||
          typeof principal.userId !== "string" || !UUID.test(principal.userId)) return deny();
      const tenantId = tenant(await deps.membershipsFor(principal.userId), principal.userId);
      const record = await deps.approvedRecordFor(tenantId, request.assetId, request.creativeVersion);
      if (!record || record.assetId !== request.assetId ||
          record.creativeVersion !== request.creativeVersion ||
          record.tenantId.toLowerCase() !== tenantId) return deny();
      const bytes = await deps.mediaFor(tenantId, request.assetId, request.creativeVersion);
      if (!(bytes instanceof Uint8Array)) deny();
      const candidate = prepareDemandCreativeIntake(tenantId, record, bytes);
      // Re-read membership and immutable metadata after potentially slow storage I/O.
      if (tenant(await deps.membershipsFor(principal.userId), principal.userId) !== tenantId) deny();
      const current = await deps.approvedRecordFor(tenantId, request.assetId, request.creativeVersion);
      if (!current || JSON.stringify(current) !== JSON.stringify(record)) deny();
      return Object.freeze({ ...candidate, admissionChecksApplied: true as const,
        membershipRecheckedAfterRead: true as const,
        approvalRecheckedAfterRead: true as const,
        // Neither metadata nor byte hashing constitutes independently verified
        // editorial signatures, permission to upload, or ad execution authority.
        approvalIndependentlyAttested: false as const,
        metaUploadAllowed: false as const, campaignExecutionAllowed: false as const });
    } catch { deny(); }
  };
}
