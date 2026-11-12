import { prepareDemandCreativeIntake, snapshotDemandCreativeRecord } from "./creative-intake.ts";

/**
 * Server-only CONTENT -> DEMAND creative admission.
 * All dependencies must be bound to trusted authentication, membership and
 * immutable tenant-scoped storage adapters. No HTTP route or Meta write here.
 */
type Principal = Readonly<{ userId: string; authenticated: true }>;
type Grant = Readonly<{ principalId: string; tenantId: string; product: "demand"; active: true }>;
type Creative = Parameters<typeof prepareDemandCreativeIntake>[1];
type VerifiedApproval = Readonly<{
  tenantId: string;
  product: "demand";
  purpose: "CREATIVE_REVIEW";
  assetId: string;
  creativeVersion: string;
  brandInstanceId: string;
  mediaSha256: string;
  approvalEvidenceId: string;
  logoAssetVersionId: string | null;
}>;
type Dependencies = Readonly<{
  authenticate: () => Promise<Principal | null>;
  membershipsFor: (userId: string) => Promise<readonly Grant[]>;
  /** Must return immutable approved metadata from authorized CONTENT storage. */
  approvedRecordFor: (tenantId: string, assetId: string, version: string) => Promise<Creative | null>;
  /** Must retrieve real bytes for the exact immutable asset/version, never a URL from client input. */
  mediaFor: (tenantId: string, assetId: string, version: string) => Promise<Uint8Array | null>;
  /** Verify authorized DEMAND reuse, current signed editorial/media QA and logo provenance in CONTENT. */
  verifyApproval: (record: Creative) => Promise<VerifiedApproval | null>;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,127}$/;
const deny = (): never => { throw new Error("BROS_DEMAND_CREATIVE_ADMISSION_DENIED"); };
const admittedTenants = new WeakMap<object, string>();

export function hasDemandCreativeAdmission(value: object, tenantId: string): boolean {
  return admittedTenants.get(value) === tenantId;
}

function exactFields(value: unknown, fields: readonly string[]): boolean {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === fields.length && fields.every(field => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    });
}

function tenant(grants: readonly Grant[], userId: string): string {
  if (!Array.isArray(grants) || grants.length !== 1) deny();
  const grant = grants[0];
  if (!grant || grant.active !== true || grant.product !== "demand" ||
      grant.principalId !== userId || typeof grant.tenantId !== "string" || !UUID.test(grant.tenantId)) deny();
  return grant.tenantId.toLowerCase();
}
export function createDemandCreativeAdmission(deps: Dependencies) {
  if (!deps || typeof deps.authenticate !== "function" ||
      typeof deps.membershipsFor !== "function" ||
      typeof deps.approvedRecordFor !== "function" ||
      typeof deps.mediaFor !== "function" ||
      typeof deps.verifyApproval !== "function") deny();
  return async (request: Readonly<{ assetId: string; creativeVersion: string }>) => {
    try {
      if (!exactFields(request, ["assetId", "creativeVersion"]) ||
          typeof request.assetId !== "string" || !ID.test(request.assetId) ||
          typeof request.creativeVersion !== "string" || !ID.test(request.creativeVersion)) deny();
      const { assetId, creativeVersion } = request;
      const principal = await deps.authenticate();
      if (!principal || principal.authenticated !== true ||
          typeof principal.userId !== "string" || !UUID.test(principal.userId)) return deny();
      const userId = principal.userId;
      const tenantId = tenant(await deps.membershipsFor(userId), userId);
      const readRecord = async () => {
        const raw = await deps.approvedRecordFor(tenantId, assetId, creativeVersion);
        if (!raw) return deny();
        const snapshot = snapshotDemandCreativeRecord(tenantId, raw);
        if (snapshot.assetId !== assetId || snapshot.creativeVersion !== creativeVersion) return deny();
        return snapshot;
      };
      const record = await readRecord();
      const bytes = await deps.mediaFor(tenantId, assetId, creativeVersion);
      if (!(bytes instanceof Uint8Array)) return deny();
      const candidate = prepareDemandCreativeIntake(tenantId, record, bytes);
      // A matching media hash and approval metadata do not independently prove editorial approval.
      const approval = await deps.verifyApproval(record);
      if (!approval || !exactFields(approval, ["tenantId", "product", "purpose", "assetId", "creativeVersion",
          "brandInstanceId", "mediaSha256", "approvalEvidenceId", "logoAssetVersionId"]) ||
          approval.tenantId !== tenantId || approval.product !== "demand" ||
          approval.purpose !== "CREATIVE_REVIEW" || approval.assetId !== assetId ||
          approval.creativeVersion !== creativeVersion || approval.brandInstanceId !== record.brandInstanceId ||
          approval.mediaSha256 !== record.sha256 || approval.approvalEvidenceId !== record.approvalEvidenceId ||
          (record.logoEvidence === "NO_LOGO" ? approval.logoAssetVersionId !== null :
            typeof approval.logoAssetVersionId !== "string" || !ID.test(approval.logoAssetVersionId))) return deny();
      const { logoAssetVersionId } = approval;
      // Re-read immutable metadata and membership after the slow I/O.
      if (JSON.stringify(await readRecord()) !== JSON.stringify(record) ||
          tenant(await deps.membershipsFor(userId), userId) !== tenantId) deny();
      const result = Object.freeze({ ...candidate, logoAssetVersionId,
        admissionChecksApplied: true as const,
        membershipRecheckedAfterRead: true as const,
        approvalRecheckedAfterRead: true as const,
        approvalIndependentlyAttested: true as const,
        metaUploadAllowed: false as const, campaignExecutionAllowed: false as const });
      admittedTenants.set(result, tenantId);
      return result;
    } catch { return deny(); }
  };
}
