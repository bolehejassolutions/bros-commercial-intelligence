export const creativeReuseFields = [
  "aiDisclosure", "approvalEvidenceId", "assetId", "brandInstanceId", "bytes", "claimsEvidence",
  "creativeVersion", "editorialQa", "logoEvidence", "mediaQa", "mime", "presetId", "presetVersion", "sha256",
  "status", "tenantId",
] as const;

type Grant = {
  schemaVersion: unknown; product: unknown; purpose: unknown; proofEnvelopeId: unknown; slot: unknown;
  approvedAt: unknown; expiresAt: unknown; logoAssetVersionId: unknown; creative: Readonly<Record<string, unknown>>;
};

export function contentCreativeReuseGrantBytes(keyId: string, grant: Grant) {
  const creative = Object.fromEntries(creativeReuseFields.map(field => [field, grant.creative[field]]));
  return new TextEncoder().encode(JSON.stringify(["BROS_CONTENT_OWNER_DEMAND_REUSE_V1", keyId,
    grant.schemaVersion, grant.product, grant.purpose, grant.proofEnvelopeId, grant.slot,
    grant.approvedAt, grant.expiresAt, grant.logoAssetVersionId, creative]));
}
