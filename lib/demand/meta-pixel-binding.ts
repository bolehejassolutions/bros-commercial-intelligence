import { createHash } from "node:crypto";

/** DEMAND-only Meta ad tracking_specs ↔ account pixel inventory observation.
 * Connector reads are NOT app-owned provider authentication or proof of events,
 * purchase attribution, delivery, paid orders, conversion or causal impact.
 */
type Scope = Readonly<{
  tenantId: string; product: "demand"; accountId: string;
  campaignId: string; adId: string; expectedPixelId: string;
}>;
type Coverage = Readonly<{
  missingScopes: readonly string[] | null;
  droppedFields?: readonly string[] | null;
}>;
type Inventory = Coverage & Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  nextPageToken: string | null;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digits = /^\d+$/;
const invalid = (): never => { throw new Error("Invalid BROS DEMAND Meta pixel binding readback"); };
const covered = (v: Coverage, critical: readonly string[]): boolean => {
  if (!v || (v.missingScopes !== null &&
    (!Array.isArray(v.missingScopes) || v.missingScopes.length !== 0)) ||
    (v.droppedFields != null && (!Array.isArray(v.droppedFields) ||
      v.droppedFields.some(f => typeof f !== "string")))) invalid();
  return !(v.droppedFields ?? []).some(f => critical.includes(f));
};

export function assessDemandMetaPixelBinding(
  scope: Scope, ad: Readonly<Record<string, unknown>>,
  adCoverage: Coverage, inventory: Inventory,
) {
  if (!scope || !uuid.test(scope.tenantId) || scope.product !== "demand" ||
    !/^act_\d+$/.test(scope.accountId) || !digits.test(scope.campaignId) ||
    !digits.test(scope.adId) || !digits.test(scope.expectedPixelId) ||
    !ad || typeof ad !== "object" || Array.isArray(ad) ||
    ad.id !== scope.adId || ad.campaign_id !== scope.campaignId ||
    typeof ad.status !== "string" || typeof ad.effective_status !== "string" ||
    !/^[A-Z_]{2,50}$/.test(ad.status) ||
    !/^[A-Z_]{2,50}$/.test(ad.effective_status) ||
    !inventory || !Array.isArray(inventory.rows) ||
    inventory.nextPageToken !== null) invalid();
  const adFieldsComplete = covered(adCoverage, ["id", "campaign_id", "tracking_specs"]);
  const pixelFieldsComplete = covered(inventory, ["id", "is_unavailable"]);
  const inventoryIds = new Set<string>();
  const inventoryObservations: Array<{id: string; available: boolean | null}> = [];
  for (const row of inventory.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
      typeof row.id !== "string" || !digits.test(row.id) ||
      inventoryIds.has(row.id) ||
      (row.is_unavailable !== undefined && typeof row.is_unavailable !== "boolean")) invalid();
    inventoryIds.add(row.id as string);
    inventoryObservations.push({
      id: row.id as string, available: row.is_unavailable === undefined ? null : !row.is_unavailable,
    });
  }
  inventoryObservations.sort((a,b) => a.id.localeCompare(b.id));
  let observedPixelIds: string[] | null = null;
  if (adFieldsComplete && Array.isArray(ad.tracking_specs)) {
    if (ad.tracking_specs.length > 100) invalid();
    const pixels = new Set<string>();
    for (const spec of ad.tracking_specs) {
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) invalid();
      const s = spec as Record<string, unknown>;
      const actions = s["action.type"];
      if (actions !== undefined && (!Array.isArray(actions) ||
        actions.some(a => typeof a !== "string"))) invalid();
      if (Array.isArray(actions) && actions.includes("offsite_conversion")) {
        if (!Array.isArray(s.fb_pixel) ||
          s.fb_pixel.some(id => typeof id !== "string" || !digits.test(id))) invalid();
        for (const id of s.fb_pixel as string[]) pixels.add(id);
      }
    }
    observedPixelIds = [...pixels].sort();
  } else if (ad.tracking_specs !== undefined && !Array.isArray(ad.tracking_specs)) {
    invalid();
  }
  const pixel = inventoryObservations.find(p => p.id === scope.expectedPixelId);
  const available = pixelFieldsComplete && pixel?.available === true;
  const bindingObserved = observedPixelIds !== null &&
    observedPixelIds.length === 1 && observedPixelIds[0] === scope.expectedPixelId &&
    available;
  const status = observedPixelIds === null || !pixelFieldsComplete ||
    (pixel && pixel.available === null) ? "PIXEL_CONFIG_UNREAD" as const :
    bindingObserved ? "PIXEL_CONFIG_MATCH_UNATTESTED" as const :
    "PIXEL_CONFIG_MISMATCH_UNATTESTED" as const;
  const snapshotId = "demand:meta-pixel-binding:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1",scope.tenantId.toLowerCase(),scope.product,
      scope.accountId,scope.campaignId,scope.adId,scope.expectedPixelId,
      ad.status,ad.effective_status,adFieldsComplete,pixelFieldsComplete,
      observedPixelIds,inventoryObservations])).digest("hex");
  return Object.freeze({
    snapshotId,status,adId:scope.adId,expectedPixelId:scope.expectedPixelId,
    observedPixelIds:observedPixelIds === null ? null : Object.freeze(observedPixelIds),
    inventoryPixelPresent:pixel !== undefined,
    inventoryPixelAvailable:pixel?.available ?? null,
    trackingPixelBindingObserved:bindingObserved,
    configuredStatus:ad.status as string,effectiveStatus:ad.effective_status as string,
    // Activity timestamps, test events and attribution aliases do not prove purchases.
    eventTypeVerified:false as const,pixelPurchaseVerified:false as const,
    clickToOrderAttributionVerified:false as const,providerAuthenticationVerified:false as const,
    tenantMembershipVerified:false as const,adServingVerified:false as const,
    verifiedOrders:null,verifiedCpaMinor:null,verifiedCacMinor:null,
    verifiedConversionRate:null,causalLift:null,
    actionExecuted:false as const,outcomeVerified:false as const,
    durableBciLearningVerified:false as const,executionAllowed:false as const,
  });
}
