import { createHash } from "node:crypto";

/**
 * BROS DEMAND-only, read-only source-selection preflight.
 * This is a caller-supplied HYPD inventory projection, NOT app-owned
 * authentication, tenant membership, GA4 capture, or payment attribution.
 * An operational connector with zero selected accounts is NOT an available
 * measurement source, and it does not prove GA4 is absent elsewhere.
 */
export type HypdSourceInventory = Readonly<{
  platforms: readonly Readonly<{
    platform: string;
    state: string;
    accounts: readonly Readonly<Record<string, unknown>>[];
  }>[];
}>;

const fail = (): never => { throw new Error("Invalid BROS DEMAND source coverage"); };
const accountPattern = /^act_[0-9]+$/;

export function assessDemandProviderSourceCoverage(
  inventory: HypdSourceInventory, requestedMetaAccountId: string,
) {
  if (!inventory || !Array.isArray(inventory.platforms) ||
      inventory.platforms.length > 20 ||
      typeof requestedMetaAccountId !== "string" ||
      !accountPattern.test(requestedMetaAccountId)) fail();
  const byPlatform = new Map<string, HypdSourceInventory["platforms"][number]>();
  for (const entry of inventory.platforms) {
    if (!entry || typeof entry !== "object" ||
        typeof entry.platform !== "string" ||
        !["google_analytics", "meta_ads"].includes(entry.platform) ||
        byPlatform.has(entry.platform) ||
        !["ready", "unavailable", "missing_scope"].includes(entry.state) ||
        !Array.isArray(entry.accounts) || entry.accounts.length > 100 ||
        entry.accounts.some(account => !account || typeof account !== "object" || Array.isArray(account))) fail();
    byPlatform.set(entry.platform, entry);
  }
  const meta = byPlatform.get("meta_ads");
  const ga4 = byPlatform.get("google_analytics");
  if (!meta || !ga4) fail();
  const selectedMeta = meta.accounts.filter(account =>
    account.adAccountId === requestedMetaAccountId);
  if (selectedMeta.length > 1) fail();
  const metaAvailable = meta.state === "ready" &&
    selectedMeta.length === 1 && selectedMeta[0].currency === "MYR" &&
    selectedMeta[0].timeZone === "Asia/Kuala_Lumpur";
  const selectedGa4PropertyIds = ga4.state === "ready"
    ? ga4.accounts.map(account => account.propertyId)
      .filter((id): id is string => typeof id === "string" &&
        /^properties\/[0-9]+$/.test(id)).sort() : [];
  const ga4Selected = selectedGa4PropertyIds.length > 0;
  const coverageStatus = !metaAvailable ? "META_SOURCE_NOT_READY" :
    !ga4Selected ? "META_ONLY_GA4_NOT_SELECTED" : "META_AND_GA4_SELECTED_UNATTESTED";
  const nextBestEvidenceAction = !metaAvailable ? "VERIFY_HYPD_META_SOURCE_SELECTION" :
    !ga4Selected ? "VERIFY_OR_SELECT_GA4_PROPERTY_IN_HYPD" :
    "OBTAIN_AUTHENTICATED_PRODUCT_SCOPED_SOURCE_RECEIPTS";
  const snapshotKey = "demand:source-coverage:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1", requestedMetaAccountId,
      meta.state, metaAvailable, ga4.state, selectedGa4PropertyIds]))
    .digest("hex");
  return Object.freeze({
    snapshotKey, coverageStatus, nextBestEvidenceAction,
    metaSelectedForReadOnlyConnector: metaAvailable,
    ga4SelectedForReadOnlyConnector: ga4Selected,
    ga4ConnectorState: ga4.state,
    // These claims require trusted app-side receipts and independent BCI evidence.
    appProviderAuthenticationVerified: false as const,
    tenantAuthorizationVerified: false as const,
    ga4UtmCaptureVerified: false as const,
    hitpayOrderAttributionVerified: false as const,
    verifiedSettledOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    causalLift: null,
    verifiedOutcome: null,
    recordedLearning: null,
  });
}
